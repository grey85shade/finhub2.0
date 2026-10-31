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
 * Resumen financiero de la pantalla de inicio: patrimonio, resultado del mes,
 * gastos por categoría, evolución del patrimonio, inversiones y gastos previstos.
 */
class DashboardController
{
    private const EVOLUTION_MONTHS = 12;
    private const TOP_CATEGORIES = 5;

    private PDO $db;
    private AuthController $authController;

    public function __construct()
    {
        $this->db = Database::getConnection();
        $this->authController = new AuthController();
    }

    public function getSummary(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];
        $today = new \DateTimeImmutable('today');

        $stmt = $this->db->prepare('
            SELECT id, bank_id, name, account_type, balance, initial_balance, iban, opening_date, currency, created_at
            FROM accounts WHERE user_id = :user_id AND is_active = 1
            ORDER BY balance DESC
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

        $stmt = $this->db->prepare('
            SELECT id, name, color_hex FROM categories WHERE user_id IS NULL OR user_id = :user_id
        ');
        $stmt->execute(['user_id' => $userId]);
        $categories = [];
        $roles = [];
        foreach ($stmt->fetchAll() as $c) {
            $categories[(int)$c['id']] = $c;
            if ($role = CategoryRoles::roleOf($c['name'])) {
                $roles[(int)$c['id']] = $role;
            }
        }

        $checking = [];
        $debts = [];
        $investments = [];
        $totals = ['checking' => 0.0, 'debts' => 0.0, 'investment' => 0.0, 'taxes' => 0.0];

        // Los impuestos de las inversiones se calculan sobre la ganancia conjunta de toda la cartera
        $investAccounts = array_values(array_filter($accounts, fn ($a) => $a['account_type'] === 'investment'));
        $portfolio = InvestmentMetrics::portfolio($investAccounts, $txByAccount, $today);
        $metricsById = array_column($portfolio['items'], null, 'id');
        $totals['taxes'] = $portfolio['totals']['tax'];

        foreach ($accounts as $acc) {
            $id = (int)$acc['id'];
            $balance = (float)$acc['balance'];
            $base = [
                'id' => $id,
                'bank_id' => $acc['bank_id'],
                'name' => $acc['name'],
                'account_type' => $acc['account_type'],
                'balance' => $balance,
                'initial_balance' => (float)$acc['initial_balance'],
                'iban' => $acc['iban'],
                'opening_date' => $acc['opening_date'],
                'currency' => $acc['currency'],
                'created_at' => $acc['created_at'],
            ];

            if ($acc['account_type'] === 'investment') {
                $investments[] = $base + $metricsById[$id] + ['net' => round($balance - $metricsById[$id]['tax'], 2)];
                $totals['investment'] += $balance;
            } elseif ($balance < 0) {
                // Una cuenta corriente en negativo es una deuda (préstamo, crédito...)
                $debts[] = $base;
                $totals['debts'] += $balance;
            } else {
                $checking[] = $base;
                $totals['checking'] += $balance;
            }
        }

        $gross = $totals['checking'] + $totals['investment'] + $totals['debts'];
        $checkingIds = array_merge(array_column($checking, 'id'), array_column($debts, 'id'));

        $monthStart = $today->modify('first day of this month');
        $prevStart = $monthStart->modify('-1 month');
        $prevEnd = $monthStart->modify('-1 day');

        Response::success('Resumen obtenido.', [
            'as_of' => $today->format('Y-m-d'),
            'totals' => [
                'net_worth' => round($gross - $totals['taxes'], 2),
                'gross_worth' => round($gross, 2),
                'checking' => round($totals['checking'], 2),
                'debts' => round($totals['debts'], 2),
                'investment' => round($totals['investment'], 2),
                'investment_net' => round($totals['investment'] - $totals['taxes'], 2),
                'taxes' => round($totals['taxes'], 2),
            ],
            'checking_accounts' => $checking,
            'debt_accounts' => $debts,
            'investments' => $investments,
            'month' => [
                'current' => ['start' => $monthStart->format('Y-m-d'), 'end' => $today->format('Y-m-d')]
                    + $this->flows($txByAccount, $checkingIds, $roles, $monthStart, $today),
                'previous' => ['start' => $prevStart->format('Y-m-d'), 'end' => $prevEnd->format('Y-m-d')]
                    + $this->flows($txByAccount, $checkingIds, $roles, $prevStart, $prevEnd),
            ],
            'categories' => $this->expensesByCategory($txByAccount, $checkingIds, $roles, $categories, $monthStart, $today),
            'evolution' => $this->evolution($accounts, $txByAccount, $today),
            'uncategorized' => $this->uncategorized($checking, $debts, $txByAccount),
            'planned' => PlannedExpenseController::summary($this->db, $userId, $categories, $today),
        ]);
    }

    /** Ingresos y gastos de las cuentas corrientes en un periodo, sin traspasos internos y con las devoluciones restando del gasto. */
    private function flows(array $txByAccount, array $accountIds, array $roles, \DateTimeImmutable $from, \DateTimeImmutable $to): array
    {
        $income = 0.0;
        $expense = 0.0;
        foreach ($this->periodTransactions($txByAccount, $accountIds, $roles, $from, $to) as [$kind, $tx]) {
            $amount = abs((float)$tx['amount']);
            if ($kind === 'income') { $income += $amount; }
            elseif ($kind === 'expense') { $expense += $amount; }
            else { $expense -= $amount; }
        }
        $savings = $income - $expense;
        return [
            'income' => round($income, 2),
            'expense' => round($expense, 2),
            'savings' => round($savings, 2),
            'savings_rate' => $income > 0 ? round($savings / $income * 100, 1) : null,
        ];
    }

    private function expensesByCategory(array $txByAccount, array $accountIds, array $roles, array $categories, \DateTimeImmutable $from, \DateTimeImmutable $to): array
    {
        $sums = [];
        foreach ($this->periodTransactions($txByAccount, $accountIds, $roles, $from, $to) as [$kind, $tx]) {
            if ($kind === 'income') { continue; }
            $key = $tx['category_id'] === null ? 0 : (int)$tx['category_id'];
            $sums[$key] = ($sums[$key] ?? 0.0) + ($kind === 'refund' ? -1 : 1) * abs((float)$tx['amount']);
        }
        $sums = array_filter($sums, fn ($v) => $v > 0.004);
        arsort($sums);
        $total = array_sum($sums);

        $items = [];
        $other = 0.0;
        foreach ($sums as $catId => $amount) {
            if (count($items) >= self::TOP_CATEGORIES) { $other += $amount; continue; }
            $cat = $categories[$catId] ?? null;
            $items[] = [
                'id' => $catId ?: null,
                'name' => $cat['name'] ?? 'Sin categoría',
                'color' => $cat['color_hex'] ?? '#64748b',
                'amount' => round($amount, 2),
                'pct' => $total > 0 ? round($amount / $total * 100, 1) : 0,
            ];
        }
        if ($other > 0) {
            $items[] = ['id' => null, 'name' => 'Otras', 'color' => '#475569', 'amount' => round($other, 2),
                'pct' => round($other / $total * 100, 1), 'is_other' => true];
        }
        return ['total' => round($total, 2), 'items' => $items];
    }

    private function periodTransactions(array $txByAccount, array $accountIds, array $roles, \DateTimeImmutable $from, \DateTimeImmutable $to): \Generator
    {
        $fromStr = $from->format('Y-m-d');
        $toStr = $to->format('Y-m-d');
        foreach ($accountIds as $accountId) {
            foreach ($txByAccount[$accountId] ?? [] as $tx) {
                if ($tx['date'] < $fromStr || $tx['date'] > $toStr) { continue; }
                $kind = CategoryRoles::classify($tx['type'], $tx['category_id'] === null ? null : (int)$tx['category_id'], $roles);
                if ($kind !== null) { yield [$kind, $tx]; }
            }
        }
    }

    /** Patrimonio bruto al cierre de cada uno de los últimos meses (el actual, a fecha de hoy). */
    private function evolution(array $accounts, array $txByAccount, \DateTimeImmutable $today): array
    {
        $points = [];
        $monthStart = $today->modify('first day of this month');
        for ($i = self::EVOLUTION_MONTHS - 1; $i >= 0; $i--) {
            $start = $monthStart->modify("-$i month");
            $end = $i === 0 ? $today : $start->modify('last day of this month');
            $value = 0.0;
            foreach ($accounts as $acc) {
                $value += AccountBalance::at($acc, $txByAccount[(int)$acc['id']] ?? [], $end->format('Y-m-d'));
            }
            $points[] = ['month' => $start->format('Y-m'), 'date' => $end->format('Y-m-d'), 'value' => round($value, 2)];
        }
        return $points;
    }

    private function uncategorized(array $checking, array $debts, array $txByAccount): array
    {
        $result = [];
        $total = 0;
        foreach (array_merge($checking, $debts) as $acc) {
            $count = 0;
            foreach ($txByAccount[$acc['id']] ?? [] as $tx) {
                if ($tx['category_id'] === null && ($tx['type'] === 'income' || $tx['type'] === 'expense')) { $count++; }
            }
            if ($count > 0) {
                $result[] = ['account' => $acc, 'count' => $count];
                $total += $count;
            }
        }
        usort($result, fn ($a, $b) => $b['count'] <=> $a['count']);
        return ['total' => $total, 'accounts' => $result];
    }
}
