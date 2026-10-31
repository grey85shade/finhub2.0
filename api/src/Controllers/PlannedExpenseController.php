<?php
declare(strict_types=1);

namespace FinHub\Controllers;

use FinHub\Config\CategoryRoles;
use FinHub\Database\Database;
use FinHub\Utils\Response;
use PDO;

/**
 * Gastos previstos: los gastos fijos (impuestos, seguros, préstamos, suministros, recibos domiciliados) que se
 * cobraron hace un año se esperan de nuevo en la misma fecha. Una previsión desaparece sola cuando este año ya hay
 * un cargo parecido cerca de esa fecha, o cuando el usuario la desestima (una vez o el concepto para siempre).
 */
class PlannedExpenseController
{
    /** Días hacia delante que se muestran en el resumen. */
    public const HORIZON_DAYS = 90;
    /** Días que una previsión no cobrada sigue a la vista después de su fecha. */
    private const OVERDUE_DAYS = 30;
    /** Margen, en días, para dar por cobrada una previsión con un cargo de este año. */
    private const MATCH_DAYS = 15;
    /** Diferencia de importe aceptada al emparejar por categoría (concepto distinto). */
    private const MATCH_AMOUNT_TOLERANCE = 0.25;

    /** Categorías de gasto fijo, por nombre en minúsculas. */
    private const FIXED_CATEGORIES = [
        'impuestos', 'seguros', 'prestamos', 'préstamos', 'hipoteca', 'alquiler', 'comunidad',
        'luz', 'agua', 'gas', 'telefonía', 'telefonia', 'internet',
    ];
    /** Prefijos de recibo domiciliado en el concepto (cuentan como fijos sea cual sea la categoría). */
    private const RECEIPT_PATTERN = '/^\s*(r\/|recibo\b|rebut\b)/iu';

    private PDO $db;
    private AuthController $authController;

    public function __construct()
    {
        $this->db = Database::getConnection();
        $this->authController = new AuthController();
    }

    /** Desestima una previsión. Body: { transaction_id, scope: 'once' | 'always' }. */
    public function dismiss(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];
        $input = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
        $scope = $input['scope'] ?? 'once';
        if (!in_array($scope, ['once', 'always'], true)) { Response::error('Opción no válida.', 422); }

        $stmt = $this->db->prepare('SELECT id, concept FROM transactions WHERE id = :id AND user_id = :user_id');
        $stmt->execute(['id' => (int)($input['transaction_id'] ?? 0), 'user_id' => $userId]);
        $tx = $stmt->fetch();
        if (!$tx) { Response::error('Previsión no encontrada.', 404); }

        $label = self::label($tx['concept']);
        if ($scope === 'once') {
            $this->db->prepare('INSERT IGNORE INTO planned_dismissals (user_id, source_tx_id, label) VALUES (:user_id, :tx, :label)')
                ->execute(['user_id' => $userId, 'tx' => (int)$tx['id'], 'label' => $label]);
            Response::success("«{$label}» desestimado esta vez.");
        }
        $this->db->prepare('INSERT IGNORE INTO planned_dismissals (user_id, concept_key, label) VALUES (:user_id, :key, :label)')
            ->execute(['user_id' => $userId, 'key' => self::conceptKey($tx['concept']), 'label' => $label]);
        Response::success("«{$label}» ya no se mostrará en los gastos previstos.");
    }

    /** Deshace un desestimado. */
    public function restore(int $id): void
    {
        $user = $this->authController->authenticate();
        $stmt = $this->db->prepare('DELETE FROM planned_dismissals WHERE id = :id AND user_id = :user_id');
        $stmt->execute(['id' => $id, 'user_id' => (int)$user['id']]);
        if (!$stmt->rowCount()) { Response::error('No encontrado.', 404); }
        Response::success('Restaurado.');
    }

    /** Previsiones de los próximos días para el resumen, más los desestimados que pueden restaurarse. */
    public static function summary(PDO $db, int $userId, array $categories, \DateTimeImmutable $today): array
    {
        $fixedCats = [];
        foreach ($categories as $id => $c) {
            $name = mb_strtolower(trim($c['name']));
            if (in_array($name, self::FIXED_CATEGORIES, true)) { $fixedCats[$id] = true; }
            if (CategoryRoles::roleOf($c['name'])) { $fixedCats[$id] = false; } // traspasos e ingresos nunca
        }

        // Cada cargo fijo del último año es la previsión del mismo día un año después; los más recientes son
        // además los cargos reales con los que se dan por cobradas las previsiones que ya han llegado.
        $todayStr = $today->format('Y-m-d');
        $overdueFrom = $today->modify('-' . self::OVERDUE_DAYS . ' days');
        $actualsFrom = $overdueFrom->modify('-' . self::MATCH_DAYS . ' days')->format('Y-m-d');
        $stmt = $db->prepare("
            SELECT t.id, t.date, t.concept, t.amount, t.category_id, a.name AS account_name
            FROM transactions t
            JOIN accounts a ON a.id = t.account_id AND a.is_active = 1 AND a.account_type = 'checking'
            WHERE t.user_id = :user_id AND t.type = 'expense' AND t.date BETWEEN :from AND :to
            ORDER BY t.date ASC, t.id ASC
        ");
        $stmt->execute(['user_id' => $userId, 'from' => $overdueFrom->modify('-1 year')->format('Y-m-d'), 'to' => $todayStr]);

        $predictions = [];
        $actuals = [];
        foreach ($stmt->fetchAll() as $tx) {
            $catId = $tx['category_id'] === null ? null : (int)$tx['category_id'];
            $isFixed = $catId !== null && isset($fixedCats[$catId])
                ? $fixedCats[$catId]
                : (bool)preg_match(self::RECEIPT_PATTERN, $tx['concept']);
            if (!$isFixed) { continue; }
            $tx['category_id'] = $catId;
            $tx['key'] = self::conceptKey($tx['concept']);
            $tx['amount'] = abs((float)$tx['amount']);
            if ($tx['date'] >= $actualsFrom) { $actuals[] = $tx; }
            $tx['expected'] = self::sameDayNextYear($tx['date']);
            $predictions[] = $tx;
        }

        // Cada cargo de este año cubre como mucho una previsión: la más cercana que encaje. Primero por concepto
        // y después, con lo que sobre, por categoría e importe parecido (el concepto cambia a veces entre años).
        $used = [];
        $rules = [
            fn ($p, $a) => $p['key'] !== '' && $p['key'] === $a['key'],
            fn ($p, $a) => $p['category_id'] !== null && $p['category_id'] === $a['category_id']
                && abs($a['amount'] - $p['amount']) <= $p['amount'] * self::MATCH_AMOUNT_TOLERANCE,
        ];
        foreach ($rules as $matches) {
            foreach ($predictions as $i => $p) {
                if (!empty($p['paid'])) { continue; }
                $best = null;
                $bestGap = PHP_INT_MAX;
                foreach ($actuals as $j => $a) {
                    if (isset($used[$j])) { continue; }
                    $gap = abs(self::daysBetween($p['expected'], $a['date']));
                    if ($gap <= self::MATCH_DAYS && $gap < $bestGap && $matches($p, $a)) { $best = $j; $bestGap = $gap; }
                }
                if ($best !== null) { $used[$best] = true; $predictions[$i]['paid'] = true; }
            }
        }

        $stmt = $db->prepare('SELECT id, source_tx_id, concept_key, label FROM planned_dismissals WHERE user_id = :user_id ORDER BY created_at DESC');
        $stmt->execute(['user_id' => $userId]);
        $dismissals = $stmt->fetchAll();
        $dismissedTx = [];
        $dismissedKeys = [];
        foreach ($dismissals as $d) {
            if ($d['source_tx_id'] !== null) { $dismissedTx[(int)$d['source_tx_id']] = (int)$d['id']; }
            else { $dismissedKeys[$d['concept_key']] = true; }
        }

        $overdueFromStr = $overdueFrom->format('Y-m-d');
        $in30 = $today->modify('+30 days')->format('Y-m-d');
        $horizonEnd = $today->modify('+' . self::HORIZON_DAYS . ' days')->format('Y-m-d');
        $items = [];
        $later = [];
        $hiddenOnce = [];
        $total30 = 0.0;
        $totalHorizon = 0.0;
        foreach ($predictions as $p) {
            if (!empty($p['paid']) || $p['expected'] < $overdueFromStr || isset($dismissedKeys[$p['key']])) { continue; }
            if (isset($dismissedTx[(int)$p['id']])) {
                $hiddenOnce[(int)$p['id']] = true;
                continue;
            }
            $cat = $p['category_id'] === null ? null : ($categories[$p['category_id']] ?? null);
            if ($p['expected'] > $horizonEnd) {
                $later[] = ['transaction_id' => (int)$p['id'], 'name' => self::label($p['concept']), 'amount' => $p['amount'], 'expected_date' => $p['expected']];
                continue;
            }
            $items[] = [
                'transaction_id' => (int)$p['id'],
                'name' => self::label($p['concept']),
                'amount' => $p['amount'],
                'expected_date' => $p['expected'],
                'last_year_date' => $p['date'],
                'account_name' => $p['account_name'],
                'category_name' => $cat['name'] ?? null,
                'color' => $cat['color_hex'] ?? '#64748b',
            ];
            $totalHorizon += $p['amount'];
            if ($p['expected'] <= $in30) { $total30 += $p['amount']; }
        }
        usort($items, fn ($a, $b) => [$a['expected_date'], $a['transaction_id']] <=> [$b['expected_date'], $b['transaction_id']]);

        // Desestimados restaurables: los conceptos para siempre y las cuotas sueltas que aún estarían a la vista
        $dismissed = [];
        foreach ($dismissals as $d) {
            if ($d['source_tx_id'] === null || isset($hiddenOnce[(int)$d['source_tx_id']])) {
                $dismissed[] = ['id' => (int)$d['id'], 'label' => $d['label'], 'scope' => $d['source_tx_id'] === null ? 'always' : 'once'];
            }
        }

        return [
            'horizon_days' => self::HORIZON_DAYS,
            'as_of' => $todayStr,
            'total_30' => round($total30, 2),
            'total_horizon' => round($totalHorizon, 2),
            'items' => $items,
            'later' => array_slice($later, 0, 3), // ya en orden de fecha: las previsiones salen de cargos ordenados
            'dismissed' => $dismissed,
        ];
    }

    /** Concepto normalizado para reconocer el mismo cargo de un año a otro (sin números de tarjeta, fechas ni referencias). */
    public static function conceptKey(string $concept): string
    {
        $key = mb_strtolower(self::label($concept));
        $key = preg_replace('/[^\p{L}]+/u', ' ', $key);
        return trim(preg_replace('/\s+/', ' ', $key));
    }

    /** Concepto para mostrar, sin prefijos bancarios. */
    public static function label(string $concept): string
    {
        $label = preg_replace('/^\s*(r\/|recibo\s*:?|rebut\s*:?)\s*/iu', '', $concept);
        $label = preg_replace('/^\s*(targeta|tarjeta)\s*\*\d+\s*/iu', '', $label);
        return trim($label) ?: trim($concept);
    }

    /** Misma fecha un año después (29 de febrero → 28). */
    private static function sameDayNextYear(string $date): string
    {
        [$y, $m, $d] = array_map('intval', explode('-', $date));
        $last = (int)(new \DateTimeImmutable(sprintf('%04d-%02d-01', $y + 1, $m)))->format('t');
        return sprintf('%04d-%02d-%02d', $y + 1, $m, min($d, $last));
    }

    private static function daysBetween(string $a, string $b): int
    {
        return (int)(new \DateTimeImmutable($a))->diff(new \DateTimeImmutable($b))->format('%r%a');
    }
}
