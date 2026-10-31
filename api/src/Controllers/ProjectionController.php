<?php
declare(strict_types=1);

namespace FinHub\Controllers;

use FinHub\Config\CategoryRoles;
use FinHub\Database\Database;
use FinHub\Utils\AccountBalance;
use FinHub\Utils\InvestmentMetrics;
use FinHub\Utils\Response;
use PDO;

/**
 * Datos de la sección Proyección: importes reales por categoría y mes del año en curso y del anterior, saldos
 * reales del año en curso, los ajustes del usuario y las celdas que ha editado. La proyección se calcula en el cliente.
 */
class ProjectionController
{
    private const MAX_YEARS = 10;
    private const MAX_PCT = 100;
    private const INCOME_ROW = 0;
    private const UNCATEGORIZED_ROW = -1;

    private PDO $db;
    private AuthController $authController;

    public function __construct()
    {
        $this->db = Database::getConnection();
        $this->authController = new AuthController();
    }

    public function getProjection(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];
        $today = new \DateTimeImmutable('today');
        $todayStr = $today->format('Y-m-d');
        $year = (int)$today->format('Y');

        $stmt = $this->db->prepare('
            SELECT c.id, c.name, c.color_hex, s.id AS supra_id, s.name AS supra_name, s.color_hex AS supra_color
            FROM categories c
            JOIN supra_categories s ON s.id = c.supra_category_id
            WHERE (c.user_id IS NULL OR c.user_id = :user_id) AND c.is_active = 1
            ORDER BY s.name, c.name
        ');
        $stmt->execute(['user_id' => $userId]);
        $categories = [];
        $roles = [];
        foreach ($stmt->fetchAll() as $c) {
            $role = CategoryRoles::roleOf($c['name']);
            if ($role) { $roles[(int)$c['id']] = $role; }
            if ($role) { continue; }
            $categories[] = [
                'id' => (int)$c['id'],
                'name' => $c['name'],
                'color' => $c['color_hex'],
                'supra_id' => (int)$c['supra_id'],
                'supra_name' => $c['supra_name'],
                'supra_color' => $c['supra_color'],
            ];
        }

        $stmt = $this->db->prepare('
            SELECT id, account_type, balance, initial_balance, opening_date
            FROM accounts WHERE user_id = :user_id AND is_active = 1
        ');
        $stmt->execute(['user_id' => $userId]);
        $accounts = $stmt->fetchAll();

        $stmt = $this->db->prepare('
            SELECT t.account_id, t.date, t.type, t.amount, t.balance_after, t.category_id
            FROM transactions t
            JOIN accounts a ON a.id = t.account_id AND a.is_active = 1
            WHERE t.user_id = :user_id
            ORDER BY t.date ASC, t.created_at ASC, t.id ASC
        ');
        $stmt->execute(['user_id' => $userId]);
        $txByAccount = [];
        foreach ($stmt->fetchAll() as $tx) {
            $txByAccount[(int)$tx['account_id']][] = $tx;
        }

        // Importe neto real por año, mes y categoría (ingresos en positivo, gastos en negativo, devoluciones restan
        // del gasto de su categoría). Solo cuentas corrientes y sin traspasos internos. Todos los ingresos van a la
        // fila 0 y los gastos sin categoría a la -1.
        $real = [$year - 1 => [], $year => []];
        $prevStart = sprintf('%04d-01-01', $year - 1);
        foreach ($accounts as $acc) {
            if ($acc['account_type'] !== 'checking') { continue; }
            foreach ($txByAccount[(int)$acc['id']] ?? [] as $tx) {
                if ($tx['date'] < $prevStart || $tx['date'] > $todayStr) { continue; }
                $categoryId = $tx['category_id'] === null ? null : (int)$tx['category_id'];
                $kind = CategoryRoles::classify($tx['type'], $categoryId, $roles);
                if ($kind === null) { continue; }
                $amount = abs((float)$tx['amount']);
                $key = $kind === 'income' ? self::INCOME_ROW : ($categoryId ?? self::UNCATEGORIZED_ROW);
                $y = (int)substr($tx['date'], 0, 4);
                $m = (int)substr($tx['date'], 5, 2);
                $real[$y][$m][$key] = ($real[$y][$m][$key] ?? 0) + ($kind === 'expense' ? -$amount : $amount);
            }
        }
        foreach ($real as $y => $months) {
            foreach ($months as $m => $cells) {
                $real[$y][$m] = array_map(fn ($v) => round($v, 2), $cells);
            }
        }

        // Saldo de las cuentas corrientes y de las de inversión al cierre del año anterior (índice 0) y de cada mes
        // ya cerrado; el último valor de las inversiones es el de hoy
        $closed = (int)$today->format('n') - 1;
        $dates = [sprintf('%04d-12-31', $year - 1)];
        for ($m = 1; $m <= $closed; $m++) {
            $dates[] = (new \DateTimeImmutable(sprintf('%04d-%02d-01', $year, $m)))->format('Y-m-t');
        }
        $liquid = array_fill(0, count($dates), 0.0);
        $invest = array_fill(0, count($dates) + 1, 0.0);
        foreach ($accounts as $acc) {
            $txs = $txByAccount[(int)$acc['id']] ?? [];
            $isInvest = $acc['account_type'] === 'investment';
            foreach ($dates as $i => $date) {
                $value = AccountBalance::at($acc, $txs, $date);
                if ($isInvest) { $invest[$i] += $value; } else { $liquid[$i] += $value; }
            }
            if ($isInvest) { $invest[count($dates)] += AccountBalance::at($acc, $txs, $todayStr); }
        }
        $investAccounts = array_values(array_filter($accounts, fn ($a) => $a['account_type'] === 'investment'));
        $hasInvest = (bool)$investAccounts;
        // La TIR real de la cartera, como referencia para la rentabilidad de la proyección
        $suggestedReturn = $hasInvest ? InvestmentMetrics::portfolio($investAccounts, $txByAccount, $today)['totals']['xirr'] : null;

        Response::success('Proyección obtenida.', [
            'year' => $year,
            'today' => $todayStr,
            'categories' => $categories,
            'real' => $real,
            'liquid' => array_map(fn ($v) => round($v, 2), $liquid),
            'investments' => $hasInvest ? array_map(fn ($v) => round($v, 2), $invest) : null,
            'suggested_investment_return' => $suggestedReturn,
            'settings' => $this->loadSettings($userId),
            'overrides' => $this->loadOverrides($userId, $year),
        ]);
    }

    public function updateSettings(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];
        $input = json_decode(file_get_contents('php://input'), true) ?? [];

        $settings = $this->loadSettings($userId);
        foreach (['inflation', 'income_growth', 'investment_return'] as $field) {
            if (!array_key_exists($field, $input)) { continue; }
            $value = $input[$field];
            if (!is_numeric($value) || abs((float)$value) > self::MAX_PCT) {
                Response::error('Porcentaje no válido.', 422);
            }
            $settings[$field] = round((float)$value, 2);
        }
        if (array_key_exists('years', $input)) {
            $years = filter_var($input['years'], FILTER_VALIDATE_INT);
            if ($years === false || $years < 0 || $years > self::MAX_YEARS) {
                Response::error('Número de años no válido.', 422);
            }
            $settings['years'] = $years;
        }

        $stmt = $this->db->prepare('
            INSERT INTO projection_settings (user_id, inflation, income_growth, investment_return, years)
            VALUES (:user_id, :inflation, :income_growth, :investment_return, :years)
            ON DUPLICATE KEY UPDATE inflation = VALUES(inflation), income_growth = VALUES(income_growth),
                investment_return = VALUES(investment_return), years = VALUES(years)
        ');
        $stmt->execute(['user_id' => $userId] + $settings);
        Response::success('Ajustes guardados.', ['settings' => $settings]);
    }

    /** Guarda una celda editada, o la borra (vuelve al valor calculado) si amount es null. */
    public function saveOverride(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $currentYear = (int)date('Y');

        $year = filter_var($input['year'] ?? null, FILTER_VALIDATE_INT);
        $month = filter_var($input['month'] ?? null, FILTER_VALIDATE_INT);
        $categoryId = filter_var($input['category_id'] ?? null, FILTER_VALIDATE_INT);
        if ($year === false || $year < $currentYear || $year > $currentYear + self::MAX_YEARS
            || $month === false || $month < 1 || $month > 12 || $categoryId === false || $categoryId < self::UNCATEGORIZED_ROW) {
            Response::error('Celda no válida.', 422);
        }
        if ($year === $currentYear && $month < (int)date('n')) {
            Response::error('Los meses cerrados muestran los datos reales y no se pueden editar.', 422);
        }
        if ($categoryId > 0) {
            $stmt = $this->db->prepare('SELECT 1 FROM categories WHERE id = :id AND (user_id IS NULL OR user_id = :user_id)');
            $stmt->execute(['id' => $categoryId, 'user_id' => $userId]);
            if (!$stmt->fetch()) { Response::error('Categoría no encontrada.', 404); }
        }

        $amount = $input['amount'] ?? null;
        if ($amount === null) {
            $stmt = $this->db->prepare('
                DELETE FROM projection_overrides
                WHERE user_id = :user_id AND year = :year AND month = :month AND category_id = :category_id
            ');
            $stmt->execute(['user_id' => $userId, 'year' => $year, 'month' => $month, 'category_id' => $categoryId]);
            Response::success('Celda restablecida.');
        }
        if (!is_numeric($amount) || abs((float)$amount) >= 1e12) {
            Response::error('Importe no válido.', 422);
        }

        $stmt = $this->db->prepare('
            INSERT INTO projection_overrides (user_id, year, month, category_id, amount, is_oneoff)
            VALUES (:user_id, :year, :month, :category_id, :amount, :is_oneoff)
            ON DUPLICATE KEY UPDATE amount = VALUES(amount), is_oneoff = VALUES(is_oneoff)
        ');
        $stmt->execute([
            'user_id' => $userId,
            'year' => $year,
            'month' => $month,
            'category_id' => $categoryId,
            'amount' => round((float)$amount, 2),
            'is_oneoff' => empty($input['oneoff']) ? 0 : 1,
        ]);
        Response::success('Celda guardada.');
    }

    /** Borra todas las celdas editadas (de los años que aún cuentan). */
    public function resetOverrides(): void
    {
        $user = $this->authController->authenticate();
        $stmt = $this->db->prepare('DELETE FROM projection_overrides WHERE user_id = :user_id');
        $stmt->execute(['user_id' => (int)$user['id']]);
        Response::success('Proyección restablecida.');
    }

    private function loadSettings(int $userId): array
    {
        $stmt = $this->db->prepare('
            SELECT inflation, income_growth, investment_return, years FROM projection_settings WHERE user_id = :user_id
        ');
        $stmt->execute(['user_id' => $userId]);
        $row = $stmt->fetch();
        return [
            'inflation' => $row ? (float)$row['inflation'] : 0.0,
            'income_growth' => $row ? (float)$row['income_growth'] : 0.0,
            'investment_return' => $row ? (float)$row['investment_return'] : 0.0,
            'years' => $row ? (int)$row['years'] : 3,
        ];
    }

    private function loadOverrides(int $userId, int $fromYear): array
    {
        $stmt = $this->db->prepare('
            SELECT year, month, category_id, amount, is_oneoff FROM projection_overrides
            WHERE user_id = :user_id AND year >= :year
        ');
        $stmt->execute(['user_id' => $userId, 'year' => $fromYear]);
        return array_map(fn ($o) => [
            'year' => (int)$o['year'],
            'month' => (int)$o['month'],
            'category_id' => (int)$o['category_id'],
            'amount' => (float)$o['amount'],
            'oneoff' => (bool)$o['is_oneoff'],
        ], $stmt->fetchAll());
    }
}
