<?php
declare(strict_types=1);

namespace FinHub\Controllers;

use FinHub\Database\Database;
use FinHub\Utils\Response;
use PDO;

class TransactionController
{
    private PDO $db;
    private AuthController $authController;

    private const VALID_TYPES = ['expense', 'income', 'update', 'internal'];
    private const MAX_IMPORT_ROWS = 2000;

    public function __construct()
    {
        $this->db = Database::getConnection();
        $this->authController = new AuthController();
    }

    public function getTransactions(int $accountId): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $accStmt = $this->db->prepare(
            'SELECT id, name, balance, iban, account_type, bank_id FROM accounts WHERE id = :id AND user_id = :user_id AND is_active = 1'
        );
        $accStmt->execute(['id' => $accountId, 'user_id' => $userId]);
        $account = $accStmt->fetch();
        if (!$account) { Response::error('Cuenta no encontrada o no autorizada.', 404); }

        $stmt = $this->db->prepare('
            SELECT t.id, t.date, t.concept, t.amount, t.type, t.balance_after, t.notes, t.created_at, t.fund_id,
                   c.id AS category_id, c.name AS category_name, c.color_hex AS category_color, c.icon AS category_icon
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.id
            WHERE t.account_id = :account_id AND t.user_id = :user_id
            ORDER BY t.date DESC, t.created_at DESC, t.id DESC
        ');
        $stmt->execute(['account_id' => $accountId, 'user_id' => $userId]);
        $rows = $stmt->fetchAll();

        $transactions = array_map(function ($row) {
            return [
                'id'            => (int)$row['id'],
                'date'          => $row['date'],
                'concept'       => $row['concept'],
                'amount'        => (float)$row['amount'],
                'type'          => $row['type'],
                'balance_after' => $row['balance_after'] !== null ? (float)$row['balance_after'] : null,
                'notes'         => $row['notes'],
                'fund_id'       => $row['fund_id'] !== null ? (int)$row['fund_id'] : null,
                'created_at'    => $row['created_at'],
                'category'      => $row['category_id'] ? [
                    'id'    => (int)$row['category_id'],
                    'name'  => $row['category_name'],
                    'color' => $row['category_color'],
                    'icon'  => $row['category_icon'],
                ] : null,
            ];
        }, $rows);

        $fundStmt = $this->db->prepare('SELECT id, isin, name FROM investment_funds WHERE account_id = :account_id AND user_id = :user_id ORDER BY weight DESC, id ASC');
        $fundStmt->execute(['account_id' => $accountId, 'user_id' => $userId]);
        $funds = array_map(fn ($f) => ['id' => (int)$f['id'], 'isin' => $f['isin'], 'name' => $f['name']], $fundStmt->fetchAll());

        Response::success('Transacciones obtenidas.', [
            'account'      => ['id' => (int)$account['id'], 'name' => $account['name'], 'balance' => (float)$account['balance'], 'iban' => $account['iban'], 'account_type' => $account['account_type'], 'bank_id' => $account['bank_id'], 'funds' => $funds],
            'transactions' => $transactions,
        ]);
    }

    public function createTransaction(int $accountId): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $accStmt = $this->db->prepare('SELECT id, balance FROM accounts WHERE id = :id AND user_id = :user_id AND is_active = 1');
        $accStmt->execute(['id' => $accountId, 'user_id' => $userId]);
        $account = $accStmt->fetch();
        if (!$account) { Response::error('Cuenta no encontrada o no autorizada.', 404); }

        $input      = $this->getJsonInput();
        $date       = trim((string)($input['date'] ?? ''));
        $concept    = trim((string)($input['concept'] ?? ''));
        $amount     = isset($input['amount']) ? (float)$input['amount'] : null;
        $type       = trim((string)($input['type'] ?? 'expense'));
        $categoryId = isset($input['category_id']) && $input['category_id'] !== '' ? (int)$input['category_id'] : null;
        $notes      = !empty($input['notes']) ? trim((string)$input['notes']) : null;
        $createRule = !empty($input['create_rule']);
        $fundId     = isset($input['fund_id']) && $input['fund_id'] !== '' && in_array($type, ['income', 'expense'], true) ? (int)$input['fund_id'] : null;

        $errors = [];
        if ($fundId !== null && !$this->fundIsAvailable($fundId, $accountId, $userId)) { $errors['fund_id'] = 'Fondo no válido.'; }
        if (empty($date) || !\DateTime::createFromFormat('Y-m-d', $date)) { $errors['date'] = 'Fecha obligatoria (YYYY-MM-DD).'; }
        if (mb_strlen($concept) < 1 || mb_strlen($concept) > 255) { $errors['concept'] = 'Concepto obligatorio (max 255).'; }
        if ($amount === null) { $errors['amount'] = 'Importe obligatorio.'; }
        if (!in_array($type, self::VALID_TYPES, true)) { $errors['type'] = 'Tipo no válido.'; }
        if ($categoryId !== null && !$this->categoryIsAvailable($categoryId, $userId)) { $errors['category_id'] = 'Categoría no válida.'; }
        if ($createRule && $categoryId === null) { $errors['create_rule'] = 'Para crear una regla hay que elegir una categoría.'; }
        if (!empty($errors)) { Response::error('Datos inválidos.', 422, $errors); }

        $this->db->beginTransaction();
        try {
            if ($createRule) { $this->upsertCategoryRule($userId, $concept, $categoryId); }
            [$newId, $newBalance, $newAccountBalance] = $this->insertRow($accountId, $userId, [
                'date' => $date, 'concept' => $concept, 'amount' => $amount, 'type' => $type,
                'category_id' => $categoryId, 'fund_id' => $fundId, 'notes' => $notes,
            ]);
            $this->db->commit();
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }

        Response::success('Transacción creada.', ['transaction' => ['id' => $newId, 'date' => $date, 'concept' => $concept, 'amount' => $amount, 'type' => $type, 'category_id' => $categoryId, 'fund_id' => $fundId, 'balance_after' => $newBalance], 'new_account_balance' => $newAccountBalance], 201);
    }

    /**
     * Inserta un movimiento ya validado, recalcula la cadena de saldos y actualiza el saldo de la cuenta.
     * Debe llamarse dentro de una transacción de base de datos. Devuelve [id, saldo tras el movimiento, saldo de la cuenta].
     */
    public function insertRow(int $accountId, int $userId, array $tx): array
    {
        $accStmt = $this->db->prepare('SELECT balance FROM accounts WHERE id = :id FOR UPDATE');
        $accStmt->execute(['id' => $accountId]);
        $accountBalance = (float)$accStmt->fetchColumn();

        $stmt = $this->db->prepare('INSERT INTO transactions (account_id, user_id, date, concept, amount, type, category_id, fund_id, balance_after, notes) VALUES (:account_id, :user_id, :date, :concept, :amount, :type, :category_id, :fund_id, NULL, :notes)');
        $stmt->execute(['account_id' => $accountId, 'user_id' => $userId, 'date' => $tx['date'], 'concept' => $tx['concept'], 'amount' => $tx['amount'],
            'type' => $tx['type'], 'category_id' => $tx['category_id'] ?? null, 'fund_id' => $tx['fund_id'] ?? null, 'notes' => $tx['notes'] ?? null]);
        $newId = (int)$this->db->lastInsertId();

        $rows = [];
        $newAccountBalance = $this->recalculateAfterInsert($accountId, $userId, $accountBalance, [$newId], $rows);
        $newBalance = $rows[array_search($newId, array_column($rows, 'id'), true)]['balance_after'];

        $this->db->prepare('UPDATE accounts SET balance = :balance WHERE id = :id')->execute(['balance' => $newAccountBalance, 'id' => $accountId]);
        return [$newId, $newBalance, $newAccountBalance];
    }

    /** Fondo de inversión de la cuenta, para asignarle una aportación o retirada. */
    private function fundIsAvailable(int $fundId, int $accountId, int $userId): bool
    {
        $stmt = $this->db->prepare('SELECT 1 FROM investment_funds WHERE id = :id AND account_id = :account_id AND user_id = :user_id');
        $stmt->execute(['id' => $fundId, 'account_id' => $accountId, 'user_id' => $userId]);
        return (bool)$stmt->fetchColumn();
    }

    /**
     * Carga masiva: recibe filas ya interpretadas (fecha, concepto, importe) en orden cronológico.
     * Descarta duplicados y filas inválidas, aplica las reglas de categoría y recalcula saldos.
     */
    public function importTransactions(int $accountId): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $accStmt = $this->db->prepare('SELECT id, balance FROM accounts WHERE id = :id AND user_id = :user_id AND is_active = 1');
        $accStmt->execute(['id' => $accountId, 'user_id' => $userId]);
        $account = $accStmt->fetch();
        if (!$account) { Response::error('Cuenta no encontrada o no autorizada.', 404); }

        $input = $this->getJsonInput();
        $rows  = $input['rows'] ?? null;
        if (!is_array($rows) || count($rows) === 0) { Response::error('No hay transacciones para importar.', 422); }
        if (count($rows) > self::MAX_IMPORT_ROWS) { Response::error('Máximo ' . self::MAX_IMPORT_ROWS . ' transacciones por carga.', 422); }

        // Cuántas transacciones existen ya por fecha + concepto + importe, para detectar duplicados.
        // Se cuenta por ocurrencias: dos cafés iguales el mismo día no son duplicados entre sí.
        $existing = [];
        $exStmt = $this->db->prepare('SELECT date, concept, amount, type FROM transactions WHERE account_id = :account_id AND user_id = :user_id');
        $exStmt->execute(['account_id' => $accountId, 'user_id' => $userId]);
        foreach ($exStmt->fetchAll() as $ex) {
            $key = $this->duplicateKey($ex['date'], $ex['concept'], $this->signedAmount((float)$ex['amount'], $ex['type']));
            $existing[$key] = ($existing[$key] ?? 0) + 1;
        }

        $rulesStmt = $this->db->prepare('SELECT concept, category_id FROM category_rules WHERE user_id = :user_id');
        $rulesStmt->execute(['user_id' => $userId]);
        $rules = [];
        foreach ($rulesStmt->fetchAll() as $rule) { $rules[mb_strtolower(trim($rule['concept']))] = (int)$rule['category_id']; }

        $toInsert = [];
        $skipped  = [];
        $seen     = [];
        foreach ($rows as $i => $row) {
            $line    = isset($row['line']) ? (int)$row['line'] : $i + 1;
            $date    = trim((string)($row['date'] ?? ''));
            $concept = trim((string)($row['concept'] ?? ''));
            $amount  = isset($row['amount']) && is_numeric($row['amount']) ? round((float)$row['amount'], 2) : null;
            $skip    = fn(string $reason) => ['line' => $line, 'date' => $date, 'concept' => $concept, 'amount' => $amount, 'reason' => $reason];

            $parsedDate = \DateTime::createFromFormat('!Y-m-d', $date);
            if (!$parsedDate || $parsedDate->format('Y-m-d') !== $date) { $skipped[] = $skip('Fecha no válida'); continue; }
            if ($concept === '') { $skipped[] = $skip('Concepto vacío'); continue; }
            if (mb_strlen($concept) > 255) { $concept = mb_substr($concept, 0, 255); }
            if ($amount === null) { $skipped[] = $skip('Importe no válido'); continue; }
            if ($amount == 0.0) { $skipped[] = $skip('Importe cero'); continue; }

            $key = $this->duplicateKey($date, $concept, $amount);
            $seen[$key] = ($seen[$key] ?? 0) + 1;
            if ($seen[$key] <= ($existing[$key] ?? 0)) { $skipped[] = $skip('Duplicada'); continue; }

            $toInsert[] = [
                'date'        => $date,
                'concept'     => $concept,
                'amount'      => abs($amount),
                'type'        => $amount < 0 ? 'expense' : 'income',
                'category_id' => $rules[mb_strtolower($concept)] ?? null,
            ];
        }

        $accountBalance = (float)$account['balance'];
        $newAccountBalance = $accountBalance;
        $categorized = 0;

        if ($toInsert) {
            $this->db->beginTransaction();
            try {
                $stmt = $this->db->prepare('INSERT INTO transactions (account_id, user_id, date, concept, amount, type, category_id, balance_after) VALUES (:account_id, :user_id, :date, :concept, :amount, :type, :category_id, NULL)');
                $newIds = [];
                foreach ($toInsert as $tx) {
                    $stmt->execute(['account_id' => $accountId, 'user_id' => $userId] + $tx);
                    $newIds[] = (int)$this->db->lastInsertId();
                    if ($tx['category_id'] !== null) { $categorized++; }
                }
                $chain = [];
                $newAccountBalance = $this->recalculateAfterInsert($accountId, $userId, $accountBalance, $newIds, $chain);
                $this->db->prepare('UPDATE accounts SET balance = :balance WHERE id = :id')->execute(['balance' => $newAccountBalance, 'id' => $accountId]);
                $this->db->commit();
            } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }
        }

        Response::success('Importación completada.', [
            'imported'            => count($toInsert),
            'categorized'         => $categorized,
            'skipped'             => $skipped,
            'new_account_balance' => $newAccountBalance,
        ]);
    }

    public function updateTransactionCategory(int $accountId, int $transactionId): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $txStmt = $this->db->prepare('SELECT id, concept FROM transactions WHERE id = :id AND account_id = :account_id AND user_id = :user_id');
        $txStmt->execute(['id' => $transactionId, 'account_id' => $accountId, 'user_id' => $userId]);
        $tx = $txStmt->fetch();
        if (!$tx) { Response::error('Transacción no encontrada o no autorizada.', 404); }

        $input      = $this->getJsonInput();
        $categoryId = isset($input['category_id']) && $input['category_id'] !== '' ? (int)$input['category_id'] : null;
        $createRule = !empty($input['create_rule']);

        $errors = [];
        if ($categoryId !== null && !$this->categoryIsAvailable($categoryId, $userId)) { $errors['category_id'] = 'Categoría no válida.'; }
        if ($createRule && $categoryId === null) { $errors['create_rule'] = 'Para crear una regla hay que elegir una categoría.'; }
        if (!empty($errors)) { Response::error('Datos inválidos.', 422, $errors); }

        $this->db->beginTransaction();
        try {
            $this->db->prepare('UPDATE transactions SET category_id = :category_id WHERE id = :id')->execute(['category_id' => $categoryId, 'id' => $transactionId]);
            if ($createRule) { $this->upsertCategoryRule($userId, $tx['concept'], $categoryId); }
            $this->db->commit();
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }

        Response::success($createRule ? 'Categoría actualizada y regla creada.' : 'Categoría actualizada.', [
            'transaction_id' => $transactionId,
            'category_id'    => $categoryId,
            'rule_created'   => $createRule,
        ]);
    }

    public function deleteTransaction(int $accountId, int $transactionId): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $txStmt = $this->db->prepare('SELECT id FROM transactions WHERE id = :id AND account_id = :account_id AND user_id = :user_id');
        $txStmt->execute(['id' => $transactionId, 'account_id' => $accountId, 'user_id' => $userId]);
        if (!$txStmt->fetch()) { Response::error('Transacción no encontrada o no autorizada.', 404); }

        $this->db->beginTransaction();
        try {
            $this->removeRow($accountId, $userId, $transactionId);
            $this->db->commit();
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }

        Response::success('Transacción eliminada.');
    }

    /** Borra un movimiento y recalcula los saldos posteriores y el de la cuenta. Debe llamarse dentro de una transacción. */
    public function removeRow(int $accountId, int $userId, int $transactionId): void
    {
        $accStmt = $this->db->prepare('SELECT balance FROM accounts WHERE id = :id AND user_id = :user_id AND is_active = 1 FOR UPDATE');
        $accStmt->execute(['id' => $accountId, 'user_id' => $userId]);
        $account = $accStmt->fetch();

        $rows = $this->fetchOrderedTransactions($accountId, $userId);
        $pos  = (int)array_search($transactionId, array_column($rows, 'id'), true);
        $last = count($rows) - 1;
        $tx   = $rows[$pos];

        $this->db->prepare('DELETE FROM transactions WHERE id = :id')->execute(['id' => $transactionId]);

        if ($account) {
            $accountBalance = (float)$account['balance'];
            if ($pos === $last) {
                $newAccountBalance = $this->reverseEffect($accountBalance, $tx['type'], $tx['amount'])
                    ?? ($pos > 0 ? $rows[$pos - 1]['balance_after'] : null)
                    ?? $accountBalance;
            } else {
                // Las transacciones posteriores a la borrada se recalculan
                $oldLastBalance = $rows[$last]['balance_after'];
                $base = $pos > 0
                    ? $rows[$pos - 1]['balance_after']
                    : $this->reverseEffect($tx['balance_after'], $tx['type'], $tx['amount']);
                array_splice($rows, $pos, 1);
                $finalBalance = $this->recalculateChain($rows, $pos, $base);
                $newAccountBalance = $this->adjustAccountBalance($accountBalance, $oldLastBalance, $finalBalance);
            }
            $this->db->prepare('UPDATE accounts SET balance = :b WHERE id = :id')->execute(['b' => $newAccountBalance, 'id' => $accountId]);
        }
    }

    /** Categoría del sistema o del usuario, y activa. */
    private function categoryIsAvailable(int $categoryId, int $userId): bool
    {
        $stmt = $this->db->prepare('SELECT 1 FROM categories WHERE id = :id AND (user_id IS NULL OR user_id = :user_id) AND is_active = 1');
        $stmt->execute(['id' => $categoryId, 'user_id' => $userId]);
        return (bool)$stmt->fetchColumn();
    }

    /** Crea (o reemplaza) la regla que asigna a una categoría todas las transacciones con ese concepto. */
    private function upsertCategoryRule(int $userId, string $concept, int $categoryId): void
    {
        $this->db->prepare('INSERT INTO category_rules (user_id, concept, category_id) VALUES (:user_id, :concept, :category_id) ON DUPLICATE KEY UPDATE category_id = VALUES(category_id)')
            ->execute(['user_id' => $userId, 'concept' => trim($concept), 'category_id' => $categoryId]);
    }

    /** Importe con signo según el tipo: los gastos se guardan en positivo con type = expense. */
    private function signedAmount(float $amount, string $type): float
    {
        if ($type === 'expense') { return -abs($amount); }
        if ($type === 'income')  { return abs($amount); }
        return $amount;
    }

    private function duplicateKey(string $date, string $concept, float $amount): string
    {
        return $date . '|' . mb_strtolower(trim($concept)) . '|' . number_format($amount, 2, '.', '');
    }

    /**
     * Recalcula saldos tras insertar $newIds y devuelve el nuevo saldo de la cuenta.
     * Si todas las nuevas son posteriores a las existentes se parte del saldo actual de la cuenta;
     * si alguna es anterior, se recalcula desde ella y la cuenta se ajusta por la diferencia.
     * $rows queda con la cadena ordenada y actualizada.
     */
    private function recalculateAfterInsert(int $accountId, int $userId, float $accountBalance, array $newIds, array &$rows): float
    {
        $rows  = $this->fetchOrderedTransactions($accountId, $userId);
        $isNew = array_flip($newIds);

        $firstNew = null;
        $oldIdx   = [];
        foreach ($rows as $i => $r) {
            if (isset($isNew[$r['id']])) { $firstNew ??= $i; } else { $oldIdx[] = $i; }
        }
        if ($firstNew === null) { return $accountBalance; }

        if (!$oldIdx || end($oldIdx) < $firstNew) {
            $final = $this->recalculateChain($rows, $firstNew, $accountBalance);
            return $final ?? $accountBalance;
        }

        $oldLastBalance = $rows[end($oldIdx)]['balance_after'];
        if ($firstNew > 0) {
            $base = $rows[$firstNew - 1]['balance_after'];
        } else {
            $firstOld = $rows[$oldIdx[0]];
            $base = $this->reverseEffect($firstOld['balance_after'], $firstOld['type'], $firstOld['amount']);
        }
        $final = $this->recalculateChain($rows, $firstNew, $base);
        return $this->adjustAccountBalance($accountBalance, $oldLastBalance, $final);
    }

    /** Transacciones de la cuenta en orden cronológico (más antigua primero). */
    private function fetchOrderedTransactions(int $accountId, int $userId): array
    {
        $stmt = $this->db->prepare('SELECT id, amount, type, balance_after FROM transactions WHERE account_id = :account_id AND user_id = :user_id ORDER BY date ASC, created_at ASC, id ASC');
        $stmt->execute(['account_id' => $accountId, 'user_id' => $userId]);
        return array_map(fn($r) => [
            'id'            => (int)$r['id'],
            'amount'        => (float)$r['amount'],
            'type'          => $r['type'],
            'balance_after' => $r['balance_after'] !== null ? (float)$r['balance_after'] : null,
        ], $stmt->fetchAll());
    }

    /**
     * Recalcula balance_after desde $from hasta el final partiendo de $base.
     * Un saldo null significa desconocido (p. ej. antes de la primera actualización de saldo).
     * Devuelve el saldo final.
     */
    private function recalculateChain(array &$rows, int $from, ?float $base): ?float
    {
        $update  = $this->db->prepare('UPDATE transactions SET balance_after = :b WHERE id = :id');
        $running = $base;
        for ($i = $from, $n = count($rows); $i < $n; $i++) {
            $running = $this->applyEffect($running, $rows[$i]['type'], $rows[$i]['amount']);
            if ($running !== $rows[$i]['balance_after']) {
                $update->execute(['b' => $running, 'id' => $rows[$i]['id']]);
                $rows[$i]['balance_after'] = $running;
            }
        }
        return $running;
    }

    private function applyEffect(?float $balance, string $type, float $amount): ?float
    {
        if ($type === 'update')  { return round($amount, 2); }
        if ($balance === null)   { return null; }
        if ($type === 'income')  { return round($balance + abs($amount), 2); }
        if ($type === 'expense') { return round($balance - abs($amount), 2); }
        return $balance;
    }

    /** Saldo previo a una transacción a partir de su balance_after (desconocido si es una actualización). */
    private function reverseEffect(?float $balanceAfter, string $type, float $amount): ?float
    {
        if ($type === 'update' || $balanceAfter === null) { return null; }
        if ($type === 'income')  { return round($balanceAfter - abs($amount), 2); }
        if ($type === 'expense') { return round($balanceAfter + abs($amount), 2); }
        return $balanceAfter;
    }

    /** Traslada al saldo de la cuenta la diferencia en el saldo final de la cadena de transacciones. */
    private function adjustAccountBalance(float $accountBalance, ?float $oldLast, ?float $newLast): float
    {
        if ($newLast === null) { return $accountBalance; }
        if ($oldLast === null) { return $newLast; }
        return round($accountBalance + ($newLast - $oldLast), 2);
    }

    private function getJsonInput(): array
    {
        $raw = file_get_contents('php://input');
        $decoded = json_decode($raw ?: '{}', true);
        return is_array($decoded) ? $decoded : [];
    }
}
