<?php
declare(strict_types=1);

namespace FinHub\Controllers;

use FinHub\Config\CategoryRoles;
use FinHub\Database\Database;
use FinHub\Utils\Response;
use PDO;

/**
 * Datos de la sección Gastos: los gastos (y devoluciones, en negativo) de las cuentas corrientes
 * en un rango de fechas. Los agregados y filtros se calculan en el cliente.
 */
class ExpenseController
{
    private const MAX_RANGE_DAYS = 3700; // ~10 años

    private PDO $db;
    private AuthController $authController;

    public function __construct()
    {
        $this->db = Database::getConnection();
        $this->authController = new AuthController();
    }

    public function getExpenses(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $from = $this->parseDate($_GET['from'] ?? '');
        $to = $this->parseDate($_GET['to'] ?? '');
        if (!$from || !$to || $from > $to) {
            Response::error('Rango de fechas no válido (from y to en formato YYYY-MM-DD).', 422);
        }
        if ($from->diff($to)->days > self::MAX_RANGE_DAYS) {
            Response::error('El rango de fechas es demasiado amplio.', 422);
        }

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
            $categories[] = [
                'id' => (int)$c['id'],
                'name' => $c['name'],
                'color' => $c['color_hex'],
                'supra_id' => (int)$c['supra_id'],
                'supra_name' => $c['supra_name'],
                'supra_color' => $c['supra_color'],
                'role' => $role,
            ];
        }

        $stmt = $this->db->prepare("
            SELECT id, bank_id, name, balance FROM accounts
            WHERE user_id = :user_id AND is_active = 1 AND account_type = 'checking'
            ORDER BY name
        ");
        $stmt->execute(['user_id' => $userId]);
        $accounts = array_map(fn ($a) => [
            'id' => (int)$a['id'], 'bank_id' => $a['bank_id'], 'name' => $a['name'], 'balance' => (float)$a['balance'],
        ], $stmt->fetchAll());

        $stmt = $this->db->prepare("
            SELECT t.id, t.account_id, t.date, t.concept, t.amount, t.type, t.category_id
            FROM transactions t
            JOIN accounts a ON a.id = t.account_id AND a.is_active = 1 AND a.account_type = 'checking'
            WHERE t.user_id = :user_id AND t.date BETWEEN :from AND :to AND t.type IN ('income', 'expense')
            ORDER BY t.date DESC, t.id DESC
        ");
        $stmt->execute(['user_id' => $userId, 'from' => $from->format('Y-m-d'), 'to' => $to->format('Y-m-d')]);

        $movements = [];
        foreach ($stmt->fetchAll() as $t) {
            $categoryId = $t['category_id'] !== null ? (int)$t['category_id'] : null;
            $kind = CategoryRoles::classify($t['type'], $categoryId, $roles);
            if ($kind !== 'expense' && $kind !== 'refund') { continue; }
            $amount = abs((float)$t['amount']);
            $movements[] = [
                'id' => (int)$t['id'],
                'account_id' => (int)$t['account_id'],
                'date' => $t['date'],
                'concept' => $t['concept'],
                'amount' => $kind === 'refund' ? -$amount : $amount, // positivo = gasto, negativo = devolución
                'category_id' => $categoryId,
            ];
        }

        Response::success('Gastos obtenidos.', [
            'from' => $from->format('Y-m-d'),
            'to' => $to->format('Y-m-d'),
            'categories' => $categories,
            'accounts' => $accounts,
            'movements' => $movements,
        ]);
    }

    private function parseDate(string $value): ?\DateTimeImmutable
    {
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        return $d && $d->format('Y-m-d') === $value ? $d : null;
    }
}
