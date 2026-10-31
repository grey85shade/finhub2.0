<?php
declare(strict_types=1);

namespace FinHub\Utils;

use FinHub\Controllers\TransactionController;
use PDO;

/**
 * Valoración automática de las cuentas de inversión a partir de sus fondos.
 *
 * Participaciones de cada fondo: cada aportación compra participaciones al valor liquidativo de su fecha y cada
 * retirada las vende. Un movimiento sin fondo asignado se reparte: las aportaciones según el peso de cada fondo
 * y las retiradas según el valor que tenía cada uno ese día. Si un fondo tiene ancla (participaciones a una
 * fecha, p. ej. las que muestra el broker), se parte de ella y solo cuentan los movimientos entre el ancla y la fecha.
 *
 * Antes de escribir nada se contrasta el cálculo con la última valoración que el usuario registró a mano: si no
 * cuadra, las participaciones están mal (faltan aportaciones o el ancla es errónea) y no se toca la cuenta.
 */
class FundValuation
{
    public const AUTO_CONCEPT = 'Valoración automática';

    /** Desviación máxima admitida frente a la última valoración manual. */
    private const MAX_MISMATCH = 0.05;

    private FundPrices $prices;

    public function __construct(private PDO $db)
    {
        $this->prices = new FundPrices($db);
    }

    /** Fondos de las cuentas indicadas: [account_id => [fondo, ...]]. */
    public function fundsByAccount(int $userId, ?array $accountIds = null): array
    {
        $stmt = $this->db->prepare('
            SELECT f.id, f.account_id, f.isin, f.symbol, f.name, f.currency, f.weight, f.anchor_units, f.anchor_date
            FROM investment_funds f JOIN accounts a ON a.id = f.account_id AND a.is_active = 1
            WHERE f.user_id = :user_id ORDER BY f.weight DESC, f.id ASC
        ');
        $stmt->execute(['user_id' => $userId]);
        $result = [];
        foreach ($stmt->fetchAll() as $f) {
            if ($accountIds !== null && !in_array((int)$f['account_id'], $accountIds, true)) { continue; }
            $result[(int)$f['account_id']][] = $f;
        }
        return $result;
    }

    /**
     * Descarga los precios necesarios y registra la valoración automática de cada cuenta con fondos.
     * Devuelve ['updated' => [account_id => valor], 'errors' => [mensaje, ...]].
     */
    public function syncUser(int $userId, bool $force = false, ?array $accountIds = null): array
    {
        $fundsByAccount = $this->fundsByAccount($userId, $accountIds);
        if (!$fundsByAccount) { return ['updated' => [], 'errors' => []]; }

        $accounts = $this->loadAccounts($userId, array_keys($fundsByAccount));
        $txByAccount = $this->loadTransactions($userId, array_keys($accounts));

        // Cada símbolo se descarga una vez, desde la fecha más antigua que necesite cualquiera de sus cuentas
        $needFrom = [];
        foreach ($fundsByAccount as $accountId => $funds) {
            if (!isset($accounts[$accountId])) { continue; }
            $start = InvestmentMetrics::startDate($accounts[$accountId], $txByAccount[$accountId] ?? []) ?? date('Y-m-d');
            foreach ($funds as $f) {
                // Hacen falta precios desde la apertura: cada movimiento se valora al precio de su fecha
                $from = min($start, $f['anchor_date'] ?? $start);
                $needFrom[$f['symbol']] = min($needFrom[$f['symbol']] ?? $from, $from);
            }
        }
        $errors = [];
        foreach ($needFrom as $symbol => $from) {
            if ($error = $this->prices->refresh($symbol, $from, $force)) { $errors[] = "{$symbol}: {$error}"; }
        }
        $prices = $this->prices->load(array_keys($needFrom));

        $updated = [];
        foreach ($fundsByAccount as $accountId => $funds) {
            if (!isset($accounts[$accountId])) { continue; }
            $valuation = self::valuation($accounts[$accountId], $funds, $txByAccount[$accountId] ?? [], $prices, date('Y-m-d'));
            if ($valuation === null) { $errors[] = "{$accounts[$accountId]['name']}: aún no hay precios de sus fondos."; continue; }
            if ($mismatch = $this->checkAgainstManual($accounts[$accountId], $funds, $txByAccount[$accountId] ?? [], $prices)) {
                $errors[] = $mismatch;
                continue;
            }
            $this->writeValuation($accountId, $userId, $valuation['date'], $valuation['value'], $txByAccount[$accountId] ?? []);
            $updated[$accountId] = $valuation['value'];
        }
        return ['updated' => $updated, 'errors' => $errors];
    }

    /**
     * Rellena el histórico de una cuenta: una valoración automática al cierre de cada mes pasado, calculada con
     * las participaciones y los precios reales. Los meses con una valoración manual se respetan, salvo que
     * $replaceManual pida sustituirlas. Devuelve el número de meses valorados o null si no hay precios.
     */
    public function rebuildHistory(int $userId, int $accountId, bool $replaceManual = false): ?int
    {
        $this->syncUser($userId, false, [$accountId]);
        $funds = $this->fundsByAccount($userId, [$accountId])[$accountId] ?? [];
        $acc = $this->loadAccounts($userId, [$accountId])[$accountId] ?? null;
        if (!$funds || !$acc) { return null; }
        $txs = $this->loadTransactions($userId, [$accountId])[$accountId] ?? [];
        $prices = $this->prices->load(array_column($funds, 'symbol'));
        $start = InvestmentMetrics::startDate($acc, $txs);
        if (!$start) { return null; }
        if (!$replaceManual && ($mismatch = $this->checkAgainstManual($acc, $funds, $txs, $prices))) {
            throw new \DomainException($mismatch);
        }

        $manualMonths = [];
        $autoIds = [];
        foreach ($txs as $tx) {
            if ($tx['type'] !== 'update') { continue; }
            if ($tx['concept'] === self::AUTO_CONCEPT || $replaceManual) { $autoIds[] = (int)$tx['id']; }
            else { $manualMonths[substr($tx['date'], 0, 7)] = true; }
        }

        $transactions = new TransactionController();
        $currentMonth = (new \DateTimeImmutable('first day of this month'))->format('Y-m');
        $count = 0;
        $this->db->beginTransaction();
        try {
            // Las automáticas anteriores se sustituyen por las nuevas (la del mes en curso la vuelve a poner la sincronización)
            foreach ($autoIds as $id) { $transactions->removeRow($accountId, $userId, $id); }
            $month = (new \DateTimeImmutable($start))->modify('first day of this month');
            for (; $month->format('Y-m') < $currentMonth; $month = $month->modify('+1 month')) {
                if (isset($manualMonths[$month->format('Y-m')])) { continue; }
                $valuation = self::valuation($acc, $funds, $txs, $prices, $month->format('Y-m-t'));
                // Sin precios de ese mes (fondo más reciente que la cuenta) no se inventa el valor
                if ($valuation === null || substr($valuation['date'], 0, 7) !== $month->format('Y-m')) { continue; }
                $transactions->insertRow($accountId, $userId, ['date' => $valuation['date'], 'concept' => self::AUTO_CONCEPT, 'amount' => $valuation['value'], 'type' => 'update']);
                $count++;
            }
            $this->db->commit();
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }

        $this->syncUser($userId, false, [$accountId]);
        return $count;
    }

    /** Borra las valoraciones automáticas de una cuenta; su saldo vuelve a ser el de los movimientos manuales. */
    public function removeAutoValuations(int $userId, int $accountId): void
    {
        $stmt = $this->db->prepare('SELECT id FROM transactions WHERE account_id = :account_id AND user_id = :user_id AND type = \'update\' AND concept = :concept');
        $stmt->execute(['account_id' => $accountId, 'user_id' => $userId, 'concept' => self::AUTO_CONCEPT]);
        $ids = $stmt->fetchAll(PDO::FETCH_COLUMN);
        if (!$ids) { return; }

        $transactions = new TransactionController();
        $this->db->beginTransaction();
        try {
            foreach ($ids as $id) { $transactions->removeRow($accountId, $userId, (int)$id); }
            $this->db->commit();
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }
    }

    /**
     * Valor de la cuenta en la fecha del último precio común a todos sus fondos (no posterior a $date).
     * Devuelve ['date', 'value', 'funds' => [fund_id => ['units', 'nav', 'nav_date', 'value']]] o null sin precios.
     */
    public static function valuation(array $acc, array $funds, array $txs, array $prices, string $date): ?array
    {
        $navDate = $date;
        foreach ($funds as $f) {
            $nav = FundPrices::navOn($prices[$f['symbol']] ?? [], $date);
            if ($nav === null) { return null; }
            $navDate = min($navDate, $nav[0]);
        }

        $units = self::units($acc, $funds, $txs, $prices, $navDate);
        $detail = [];
        $value = 0.0;
        foreach ($funds as $f) {
            [$d, $nav] = FundPrices::navOn($prices[$f['symbol']], $navDate);
            $fundValue = $units[(int)$f['id']] * $nav;
            $detail[(int)$f['id']] = ['units' => round($units[(int)$f['id']], 6), 'nav' => $nav, 'nav_date' => $d, 'value' => round($fundValue, 2)];
            $value += $fundValue;
        }
        return ['date' => $navDate, 'value' => round($value, 2), 'funds' => $detail];
    }

    /**
     * Participaciones de cada fondo al final de $date: [fund_id => participaciones]. Con ancla se parte de ella en
     * ambos sentidos (sumando los movimientos posteriores o restando los anteriores), así no depende de que estén
     * registradas todas las aportaciones desde la apertura; sin ancla, se suman los movimientos desde la apertura.
     */
    public static function units(array $acc, array $funds, array $txs, array $prices, string $date): array
    {
        $deltas = self::flowUnits($acc, $funds, $txs, $prices);
        $units = [];
        foreach ($funds as $f) {
            $id = (int)$f['id'];
            $anchor = $f['anchor_date'];
            $total = $anchor !== null ? (float)$f['anchor_units'] : 0.0;
            foreach ($deltas as [$flowDate, $byFund]) {
                if ($anchor === null) {
                    if ($flowDate <= $date) { $total += $byFund[$id]; }
                } elseif ($date >= $anchor) {
                    if ($flowDate > $anchor && $flowDate <= $date) { $total += $byFund[$id]; }
                } elseif ($flowDate > $date && $flowDate <= $anchor) {
                    $total -= $byFund[$id];
                }
            }
            $units[$id] = max(0.0, $total);
        }
        return $units;
    }

    /** Participaciones que compra o vende cada flujo en cada fondo: [[fecha, [fund_id => participaciones]], ...]. */
    private static function flowUnits(array $acc, array $funds, array $txs, array $prices): array
    {
        $units = [];
        $weights = [];
        foreach ($funds as $f) {
            $id = (int)$f['id'];
            $units[$id] = 0.0;
            $weights[$id] = max(0.0, (float)$f['weight']);
        }
        $totalWeight = array_sum($weights);
        foreach ($weights as $id => $w) {
            $weights[$id] = $totalWeight > 0 ? $w / $totalWeight : 1 / count($weights);
        }

        // Flujos: el saldo inicial en la apertura y las aportaciones y retiradas, con su fondo si lo tienen
        $flows = [];
        $start = InvestmentMetrics::startDate($acc, $txs);
        if ((float)$acc['initial_balance'] > 0 && $start) {
            $flows[] = ['date' => $start, 'amount' => (float)$acc['initial_balance'], 'fund_id' => null];
        }
        foreach ($txs as $tx) {
            if ($tx['type'] !== 'income' && $tx['type'] !== 'expense') { continue; }
            $flows[] = [
                'date' => $tx['date'],
                'amount' => ($tx['type'] === 'income' ? 1 : -1) * abs((float)$tx['amount']),
                'fund_id' => $tx['fund_id'] !== null ? (int)$tx['fund_id'] : null,
            ];
        }

        usort($flows, fn ($a, $b) => strcmp($a['date'], $b['date']));

        $byId = array_column($funds, null, 'id');
        $result = [];
        foreach ($flows as $flow) {
            $navs = [];
            foreach ($byId as $id => $f) {
                $nav = FundPrices::navOn($prices[$f['symbol']] ?? [], $flow['date']);
                $navs[$id] = $nav ? $nav[1] : null;
            }

            if ($flow['fund_id'] !== null && isset($byId[$flow['fund_id']])) {
                $shares = [$flow['fund_id'] => 1.0];
            } elseif ($flow['amount'] >= 0) {
                $shares = $weights;
            } else {
                // Una retirada sin fondo vende de cada uno en proporción a su valor de ese día
                $values = [];
                foreach ($units as $id => $u) { $values[$id] = $navs[$id] ? max(0.0, $u * $navs[$id]) : 0.0; }
                $total = array_sum($values);
                $shares = $total > 0 ? array_map(fn ($v) => $v / $total, $values) : $weights;
            }

            $byFund = array_fill_keys(array_keys($units), 0.0);
            foreach ($shares as $id => $share) {
                if (!$navs[$id]) { continue; }
                $byFund[$id] = $flow['amount'] * $share / $navs[$id];
                $units[$id] += $byFund[$id];
            }
            $result[] = [$flow['date'], $byFund];
        }
        return $result;
    }

    /**
     * Valora los fondos en la fecha de la última valoración manual de la cuenta para compararla con lo registrado.
     * Devuelve ['date', 'registered', 'computed', 'ok'] o null si no hay con qué comparar.
     */
    public static function compareWithManual(array $acc, array $funds, array $txs, array $prices): ?array
    {
        $manual = null;
        foreach ($txs as $tx) {
            if ($tx['type'] === 'update' && $tx['concept'] !== self::AUTO_CONCEPT) { $manual = $tx; }
        }
        if (!$funds || $manual === null || (float)$manual['amount'] <= 0) { return null; }

        $computed = self::valuation($acc, $funds, $txs, $prices, $manual['date']);
        // Sin precios de esa fecha (fondo más reciente que la valoración) no hay comparación posible
        if ($computed === null || $computed['date'] < (new \DateTimeImmutable($manual['date']))->modify('-7 days')->format('Y-m-d')) { return null; }

        $registered = (float)$manual['amount'];
        return [
            'date' => $manual['date'],
            'registered' => $registered,
            'computed' => $computed['value'],
            'ok' => abs($computed['value'] - $registered) / $registered <= self::MAX_MISMATCH,
        ];
    }

    /** Mensaje para el usuario si los fondos no cuadran con su última valoración manual, o null si cuadran. */
    private function checkAgainstManual(array $acc, array $funds, array $txs, array $prices): ?string
    {
        $check = self::compareWithManual($acc, $funds, $txs, $prices);
        if ($check === null || $check['ok']) { return null; }

        $fmt = fn (float $v) => number_format($v, 2, ',', '.') . ' €';
        $day = (new \DateTimeImmutable($check['date']))->format('d/m/Y');
        $share = round($check['computed'] / $check['registered'] * 100);
        // Por debajo lo normal es que falten fondos por añadir (se añaden de uno en uno)
        $hint = $check['computed'] < $check['registered']
            ? 'Si faltan fondos por añadir, añádelos; si no, revisa las participaciones.'
            : 'Revisa las participaciones: deben ser las que te muestra tu broker.';
        return "{$acc['name']}: los fondos suman {$fmt($check['computed'])} el {$day} ({$share} % de los {$fmt($check['registered'])} que registraste). "
            . "{$hint} Hasta que cuadre, el valor de la cuenta no se actualiza.";
    }

    /**
     * Registra la valoración como movimiento de actualización. Se conserva solo la última valoración automática
     * de cada mes, así el histórico mensual queda completo sin llenar la cuenta de movimientos diarios.
     */
    private function writeValuation(int $accountId, int $userId, string $date, float $value, array $txs): void
    {
        $month = substr($date, 0, 7);
        $toRemove = [];
        foreach ($txs as $tx) {
            if ($tx['type'] !== 'update') { continue; }
            $isAuto = $tx['concept'] === self::AUTO_CONCEPT;
            // Una valoración manual igual o posterior manda sobre la automática
            if (!$isAuto && $tx['date'] >= $date) { return; }
            if ($isAuto && $tx['date'] === $date && abs((float)$tx['amount'] - $value) < 0.005) { return; }
            if ($isAuto && substr($tx['date'], 0, 7) === $month && $tx['date'] <= $date) { $toRemove[] = (int)$tx['id']; }
        }

        $transactions = new TransactionController();
        $this->db->beginTransaction();
        try {
            foreach ($toRemove as $id) { $transactions->removeRow($accountId, $userId, $id); }
            $transactions->insertRow($accountId, $userId, ['date' => $date, 'concept' => self::AUTO_CONCEPT, 'amount' => $value, 'type' => 'update']);
            $this->db->commit();
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }
    }

    private function loadAccounts(int $userId, array $ids): array
    {
        $in = implode(',', array_map('intval', $ids));
        $stmt = $this->db->prepare("
            SELECT id, name, balance, initial_balance, opening_date FROM accounts
            WHERE user_id = :user_id AND is_active = 1 AND account_type = 'investment' AND id IN ($in)
        ");
        $stmt->execute(['user_id' => $userId]);
        return array_column($stmt->fetchAll(), null, 'id');
    }

    private function loadTransactions(int $userId, array $accountIds): array
    {
        if (!$accountIds) { return []; }
        $in = implode(',', array_map('intval', $accountIds));
        $stmt = $this->db->prepare("
            SELECT id, account_id, date, concept, type, amount, fund_id FROM transactions
            WHERE user_id = :user_id AND account_id IN ($in)
            ORDER BY date ASC, created_at ASC, id ASC
        ");
        $stmt->execute(['user_id' => $userId]);
        $result = [];
        foreach ($stmt->fetchAll() as $tx) { $result[(int)$tx['account_id']][] = $tx; }
        return $result;
    }
}
