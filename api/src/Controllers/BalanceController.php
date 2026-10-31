<?php
declare(strict_types=1);

namespace FinHub\Controllers;

use FinHub\Config\CategoryRoles;
use FinHub\Database\Database;
use FinHub\Utils\AccountBalance;
use FinHub\Utils\Response;
use PDO;

/**
 * Datos de la sección Balances de un año: saldo de cada cuenta al cierre de cada mes, y los movimientos de
 * las cuentas corrientes del año y del anterior (para comparar).
 * El filtro por cuentas y los totales se calculan en el cliente.
 */
class BalanceController
{
    private PDO $db;
    private AuthController $authController;

    public function __construct()
    {
        $this->db = Database::getConnection();
        $this->authController = new AuthController();
    }

    public function getBalance(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];
        $today = new \DateTimeImmutable('today');
        $currentYear = (int)$today->format('Y');

        $year = (int)($_GET['year'] ?? $currentYear);
        if ($year < 1990 || $year > $currentYear) {
            Response::error('Año no válido.', 422);
        }
        $yearStart = sprintf('%04d-01-01', $year);
        $yearEnd = sprintf('%04d-12-31', $year);
        $prevStart = sprintf('%04d-01-01', $year - 1);

        $stmt = $this->db->prepare('
            SELECT id, bank_id, name, account_type, balance, initial_balance, opening_date
            FROM accounts WHERE user_id = :user_id AND is_active = 1
            ORDER BY account_type, name
        ');
        $stmt->execute(['user_id' => $userId]);
        $accounts = $stmt->fetchAll();

        $stmt = $this->db->prepare('
            SELECT t.id, t.account_id, t.date, t.concept, t.type, t.amount, t.balance_after, t.category_id
            FROM transactions t
            JOIN accounts a ON a.id = t.account_id AND a.is_active = 1
            WHERE t.user_id = :user_id
            ORDER BY t.date ASC, t.created_at ASC, t.id ASC
        ');
        $stmt->execute(['user_id' => $userId]);
        $txByAccount = [];
        $firstDate = null;
        foreach ($stmt->fetchAll() as $tx) {
            $txByAccount[(int)$tx['account_id']][] = $tx;
            if ($firstDate === null || $tx['date'] < $firstDate) { $firstDate = $tx['date']; }
        }
        foreach ($accounts as $acc) {
            if ($acc['opening_date'] && ($firstDate === null || $acc['opening_date'] < $firstDate)) { $firstDate = $acc['opening_date']; }
        }

        $stmt = $this->db->prepare('
            SELECT c.id, c.name, c.color_hex, s.id AS supra_id, s.name AS supra_name, s.color_hex AS supra_color
            FROM categories c
            JOIN supra_categories s ON s.id = c.supra_category_id
            WHERE c.user_id IS NULL OR c.user_id = :user_id
        ');
        $stmt->execute(['user_id' => $userId]);
        $categories = [];
        $roles = [];
        foreach ($stmt->fetchAll() as $c) {
            if ($role = CategoryRoles::roleOf($c['name'])) {
                $roles[(int)$c['id']] = $role;
            }
            $categories[] = [
                'id' => (int)$c['id'],
                'name' => $c['name'],
                'color' => $c['color_hex'],
                'supra_id' => (int)$c['supra_id'],
                'supra_name' => $c['supra_name'],
                'supra_color' => $c['supra_color'],
            ];
        }

        // Saldo al cierre del año anterior (apertura) y de cada mes; null en los meses que aún no han empezado
        $balances = [];
        $todayStr = $today->format('Y-m-d');
        foreach ($accounts as $acc) {
            $txs = $txByAccount[(int)$acc['id']] ?? [];
            // Una cuenta abierta durante el año parte de su saldo inicial, para que no cuente como ganancia
            $openedThisYear = $acc['opening_date'] && $acc['opening_date'] >= $yearStart && $acc['opening_date'] <= $yearEnd;
            $opening = $openedThisYear ? (float)$acc['initial_balance'] : AccountBalance::at($acc, $txs, sprintf('%04d-12-31', $year - 1));
            $points = [round($opening, 2)];
            for ($m = 1; $m <= 12; $m++) {
                $start = sprintf('%04d-%02d-01', $year, $m);
                if ($start > $todayStr) { $points[] = null; continue; }
                $end = min((new \DateTimeImmutable($start))->format('Y-m-t'), $todayStr);
                $points[] = round(AccountBalance::at($acc, $txs, $end), 2);
            }
            $balances[(int)$acc['id']] = $points;
        }

        // Movimientos de las cuentas corrientes: ingresos, gastos (las devoluciones en negativo) y traspasos
        // internos (positivos si entran). Los traspasos solo cuentan en el cliente cuando se mira una sola cuenta.
        $movements = [];
        foreach ($accounts as $acc) {
            if ($acc['account_type'] !== 'checking') { continue; }
            $accountId = (int)$acc['id'];
            foreach ($txByAccount[$accountId] ?? [] as $tx) {
                if ($tx['date'] < $prevStart || $tx['date'] > $yearEnd) { continue; }
                if ($tx['type'] !== 'income' && $tx['type'] !== 'expense') { continue; }
                $categoryId = $tx['category_id'] === null ? null : (int)$tx['category_id'];
                $amount = abs((float)$tx['amount']);
                $kind = CategoryRoles::classify($tx['type'], $categoryId, $roles);
                if ($kind === null) {
                    $kind = 'transfer';
                    $amount = $tx['type'] === 'income' ? $amount : -$amount;
                } elseif ($kind === 'refund') {
                    $kind = 'expense';
                    $amount = -$amount;
                }
                $movements[] = [
                    'id' => (int)$tx['id'],
                    'account_id' => $accountId,
                    'date' => $tx['date'],
                    'concept' => $tx['concept'],
                    'category_id' => $categoryId,
                    'kind' => $kind,
                    'amount' => $amount,
                ];
            }
        }

        $firstYear = $firstDate ? (int)substr($firstDate, 0, 4) : $currentYear;
        Response::success('Balance obtenido.', [
            'year' => $year,
            'today' => $todayStr,
            'years' => range($currentYear, min($firstYear, $currentYear)),
            'accounts' => array_map(fn ($a) => [
                'id' => (int)$a['id'],
                'bank_id' => $a['bank_id'],
                'name' => $a['name'],
                'account_type' => $a['account_type'],
                'balance' => (float)$a['balance'],
            ], $accounts),
            'categories' => $categories,
            'balances' => $balances,
            'movements' => $movements,
        ]);
    }
}
