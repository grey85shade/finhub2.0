<?php
declare(strict_types=1);

namespace FinHub\Controllers;

use FinHub\Database\Database;
use FinHub\Utils\AccountBalance;
use FinHub\Utils\FundPrices;
use FinHub\Utils\FundValuation;
use FinHub\Utils\InvestmentMetrics;
use FinHub\Utils\Response;
use PDO;

/**
 * Sección de inversiones: métricas de la cartera y de cada cuenta, evolución del valor frente al
 * capital aportado, rentabilidad por año natural y movimientos de las cuentas de inversión.
 */
class InvestmentController
{
    private const MAX_EVOLUTION_MONTHS = 120;
    private const CONTRIBUTION_MONTHS = 12;

    private PDO $db;
    private AuthController $authController;

    public function __construct()
    {
        $this->db = Database::getConnection();
        $this->authController = new AuthController();
    }

    public function getInvestments(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];
        $today = new \DateTimeImmutable('today');

        $stmt = $this->db->prepare('
            SELECT id, bank_id, name, balance, initial_balance, opening_date, currency, created_at
            FROM accounts WHERE user_id = :user_id AND is_active = 1 AND account_type = \'investment\'
            ORDER BY balance DESC
        ');
        $stmt->execute(['user_id' => $userId]);
        $accounts = $stmt->fetchAll();

        $stmt = $this->db->prepare('
            SELECT t.id, t.account_id, t.date, t.concept, t.type, t.amount, t.balance_after, t.fund_id
            FROM transactions t
            JOIN accounts a ON a.id = t.account_id AND a.is_active = 1 AND a.account_type = \'investment\'
            WHERE t.user_id = :user_id
            ORDER BY t.date ASC, t.created_at ASC, t.id ASC
        ');
        $stmt->execute(['user_id' => $userId]);
        $txByAccount = [];
        foreach ($stmt->fetchAll() as $tx) {
            $txByAccount[(int)$tx['account_id']][] = $tx;
        }

        $portfolio = InvestmentMetrics::portfolio($accounts, $txByAccount, $today);
        $fundsByAccount = (new FundValuation($this->db))->fundsByAccount($userId);
        $prices = (new FundPrices($this->db))->load(array_column(array_merge([], ...array_values($fundsByAccount)), 'symbol'));
        $flowsByAccount = [];
        $items = [];
        foreach ($accounts as $i => $acc) {
            $id = (int)$acc['id'];
            $txs = $txByAccount[$id] ?? [];
            $flowsByAccount[$id] = InvestmentMetrics::cashFlows($acc, $txs);
            $metrics = $portfolio['items'][$i];
            $updates = array_filter($txs, fn ($tx) => $tx['type'] === 'update');
            $items[] = [
                'id' => $id,
                'bank_id' => $acc['bank_id'],
                'name' => $acc['name'],
                'account_type' => 'investment',
                'balance' => (float)$acc['balance'],
                'initial_balance' => (float)$acc['initial_balance'],
                'opening_date' => $acc['opening_date'],
                'currency' => $acc['currency'],
                'last_valuation' => $updates ? end($updates)['date'] : null,
                'funds' => $this->fundsDetail($acc, $fundsByAccount[$id] ?? [], $txs, $prices, $today),
                'fund_check' => FundValuation::compareWithManual($acc, $fundsByAccount[$id] ?? [], $txs, $prices),
            ] + $metrics + ['net' => round((float)$acc['balance'] - $metrics['tax'], 2)];
        }

        $since = $today->modify('first day of this month')->modify('-' . (self::CONTRIBUTION_MONTHS - 1) . ' month')->format('Y-m-d');
        $recent = 0.0;
        foreach ($flowsByAccount as $flows) {
            foreach ($flows as [$d, $amount]) {
                if ($d >= $since) { $recent += $amount; }
            }
        }

        Response::success('Inversiones obtenidas.', [
            'as_of' => $today->format('Y-m-d'),
            'totals' => $portfolio['totals'] + [
                'contributed_12m' => round($recent, 2),
                'monthly_contribution' => round($recent / self::CONTRIBUTION_MONTHS, 2),
            ],
            'accounts' => $items,
            'evolution' => $this->evolution($accounts, $txByAccount, $flowsByAccount, $today),
            'annual' => $this->annualReturns($accounts, $txByAccount, $flowsByAccount, $today),
            'movements' => $this->movements($accounts, $txByAccount),
        ]);
    }

    /** Fondos de una cuenta con sus participaciones, último valor liquidativo y valor actual (de los precios ya guardados). */
    private function fundsDetail(array $acc, array $funds, array $txs, array $prices, \DateTimeImmutable $today): array
    {
        if (!$funds) { return []; }
        $valuation = FundValuation::valuation($acc, $funds, $txs, $prices, $today->format('Y-m-d'));
        return array_map(function ($f) use ($valuation, $prices) {
            $detail = $valuation['funds'][(int)$f['id']] ?? null;
            $series = $prices[$f['symbol']] ?? [];
            $navs = array_values($series);
            // Variación del valor liquidativo en el último año (aprox. 252 sesiones)
            $yearAgo = count($navs) > 252 ? $navs[count($navs) - 253] : null;
            return [
                'id' => (int)$f['id'],
                'isin' => $f['isin'],
                'symbol' => $f['symbol'],
                'name' => $f['name'],
                'currency' => $f['currency'],
                'weight' => (float)$f['weight'],
                'anchor_units' => $f['anchor_units'] !== null ? (float)$f['anchor_units'] : null,
                'anchor_date' => $f['anchor_date'],
                'units' => $detail['units'] ?? null,
                'nav' => $detail['nav'] ?? null,
                'nav_date' => $detail['nav_date'] ?? null,
                'value' => $detail['value'] ?? null,
                'nav_change_1y' => $yearAgo && $navs ? round((end($navs) / $yearAgo - 1) * 100, 2) : null,
            ];
        }, $funds);
    }

    /** Valor y capital aportado al cierre de cada mes desde la primera inversión (el actual, a fecha de hoy). */
    private function evolution(array $accounts, array $txByAccount, array $flowsByAccount, \DateTimeImmutable $today): array
    {
        $starts = array_filter(array_map(
            fn ($acc) => InvestmentMetrics::startDate($acc, $txByAccount[(int)$acc['id']] ?? []),
            $accounts
        ));
        if (!$starts) { return []; }

        $monthStart = $today->modify('first day of this month');
        $first = (new \DateTimeImmutable(min($starts)))->modify('first day of this month');
        $first = max($first, $monthStart->modify('-' . (self::MAX_EVOLUTION_MONTHS - 1) . ' month'));

        $points = [];
        for ($start = $first; $start <= $monthStart; $start = $start->modify('+1 month')) {
            $end = $start == $monthStart ? $today : $start->modify('last day of this month');
            $date = $end->format('Y-m-d');
            $value = 0.0;
            $contributed = 0.0;
            foreach ($accounts as $acc) {
                $id = (int)$acc['id'];
                $value += AccountBalance::at($acc, $txByAccount[$id] ?? [], $date);
                $contributed += InvestmentMetrics::contributedAt($flowsByAccount[$id], $date);
            }
            $points[] = [
                'month' => $start->format('Y-m'),
                'date' => $date,
                'value' => round($value, 2),
                'contributed' => round($contributed, 2),
            ];
        }
        return $points;
    }

    /** Rentabilidad de cada año natural (Modified Dietz), de la cartera y de cada cuenta. */
    private function annualReturns(array $accounts, array $txByAccount, array $flowsByAccount, \DateTimeImmutable $today): array
    {
        $starts = array_filter(array_map(
            fn ($acc) => InvestmentMetrics::startDate($acc, $txByAccount[(int)$acc['id']] ?? []),
            $accounts
        ));
        if (!$starts) { return []; }

        $years = [];
        for ($year = (int)substr(min($starts), 0, 4), $last = (int)$today->format('Y'); $year <= $last; $year++) {
            $from = "$year-01-01";
            $to = $year === $last ? $today->format('Y-m-d') : "$year-12-31";
            $prevEnd = ($year - 1) . '-12-31';

            $total = ['start' => 0.0, 'end' => 0.0, 'flows' => []];
            $byAccount = [];
            foreach ($accounts as $acc) {
                $id = (int)$acc['id'];
                $txs = $txByAccount[$id] ?? [];
                $start = InvestmentMetrics::startDate($acc, $txs);
                if (!$start || $start > $to) { continue; }

                $startValue = $start > $prevEnd ? 0.0 : AccountBalance::at($acc, $txs, $prevEnd);
                $endValue = AccountBalance::at($acc, $txs, $to);
                $flows = $flowsByAccount[$id];
                // Una cuenta abierta a mitad de año se mide desde su apertura, no desde el 1 de enero
                $byAccount[$id] = InvestmentMetrics::modifiedDietz($startValue, $endValue, $flows, max($from, $start), $to);

                $total['start'] += $startValue;
                $total['end'] += $endValue;
                array_push($total['flows'], ...$flows);
            }

            $net = 0.0;
            foreach ($total['flows'] as [$d, $amount]) {
                if ($d >= $from && $d <= $to) { $net += $amount; }
            }
            $years[] = [
                'year' => $year,
                'is_current' => $year === $last,
                'start_value' => round($total['start'], 2),
                'end_value' => round($total['end'], 2),
                'net_contributions' => round($net, 2),
                'gain' => round($total['end'] - $total['start'] - $net, 2),
                'return_pct' => InvestmentMetrics::modifiedDietz($total['start'], $total['end'], $total['flows'], $from, $to),
                'accounts' => (object)$byAccount,
            ];
        }
        return array_reverse($years);
    }

    /** Aportaciones, retiradas y valoraciones de las cuentas de inversión, de la más reciente a la más antigua. */
    private function movements(array $accounts, array $txByAccount): array
    {
        $result = [];
        foreach ($accounts as $acc) {
            foreach ($txByAccount[(int)$acc['id']] ?? [] as $tx) {
                if (!in_array($tx['type'], ['income', 'expense', 'update'], true)) { continue; }
                $result[] = [
                    'id' => (int)$tx['id'],
                    'account_id' => (int)$acc['id'],
                    'date' => $tx['date'],
                    'concept' => $tx['concept'],
                    'type' => $tx['type'],
                    'amount' => abs((float)$tx['amount']),
                    'balance_after' => $tx['balance_after'] !== null ? (float)$tx['balance_after'] : null,
                ];
            }
        }
        usort($result, fn ($a, $b) => [$b['date'], $b['id']] <=> [$a['date'], $a['id']]);
        return $result;
    }
}
