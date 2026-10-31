<?php
declare(strict_types=1);

namespace FinHub\Controllers;

use FinHub\Config\BankCatalog;
use FinHub\Database\Database;
use FinHub\Utils\Response;
use PDO;

class AccountController
{
    private PDO $db;
    private AuthController $authController;

    public function __construct()
    {
        $this->db = Database::getConnection();
        $this->authController = new AuthController();
    }

    /**
     * Retorna el catálogo completo de bancos disponibles
     */
    public function getBanks(): void
    {
        $this->authController->authenticate();
        Response::success('Catálogo de bancos obtenido.', [
            'banks' => BankCatalog::getAll()
        ]);
    }

    /**
     * Obtiene las cuentas del usuario agrupadas por banco
     */
    public function getAccounts(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $stmt = $this->db->prepare('
            SELECT 
                a.id,
                a.bank_id,
                a.name,
                a.account_type,
                a.balance,
                a.initial_balance,
                a.iban,
                a.opening_date,
                a.currency,
                a.created_at
            FROM accounts a
            WHERE a.user_id = :user_id AND a.is_active = 1
            ORDER BY a.bank_id ASC, a.created_at DESC
        ');
        $stmt->execute(['user_id' => $userId]);
        $accounts = $stmt->fetchAll();

        // Agrupar cuentas bajo la jerarquía Banco > Cuentas
        $grouped = [];
        $totalBalance = 0.0;
        $totalChecking = 0.0;
        $totalInvestment = 0.0;

        foreach ($accounts as $acc) {
            $bankId = $acc['bank_id'];
            $bankMeta = BankCatalog::find($bankId) ?? [
                'id' => $bankId,
                'name' => ucfirst(str_replace('_', ' ', $bankId)),
                'short_name' => ucfirst($bankId),
                'color' => '#38bdf8',
                'accent' => '#0284c7',
            ];

            if (!isset($grouped[$bankId])) {
                $grouped[$bankId] = [
                    'bank' => $bankMeta,
                    'total_balance' => 0.0,
                    'accounts_count' => 0,
                    'accounts' => []
                ];
            }

            $bal = (float)$acc['balance'];
            $grouped[$bankId]['total_balance'] += $bal;
            $grouped[$bankId]['accounts_count']++;
            $totalBalance += $bal;

            if ($acc['account_type'] === 'investment') {
                $totalInvestment += $bal;
            } else {
                $totalChecking += $bal;
            }

            $grouped[$bankId]['accounts'][] = [
                'id' => (int)$acc['id'],
                'name' => $acc['name'],
                'account_type' => $acc['account_type'],
                'balance' => $bal,
                'initial_balance' => (float)$acc['initial_balance'],
                'iban' => $acc['iban'],
                'opening_date' => $acc['opening_date'],
                'currency' => $acc['currency'],
                'created_at' => $acc['created_at'],
            ];
        }

        Response::success('Cuentas obtenidas correctamente.', [
            'summary' => [
                'total_balance' => $totalBalance,
                'total_checking' => $totalChecking,
                'total_investment' => $totalInvestment,
                'banks_count' => count($grouped),
                'accounts_count' => count($accounts)
            ],
            'bank_groups' => array_values($grouped)
        ]);
    }

    /**
     * Crear una nueva cuenta bancaria
     */
    public function createAccount(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $input = $this->getJsonInput();

        $bankId = trim((string)($input['bank_id'] ?? ''));
        $name = trim((string)($input['name'] ?? ''));
        $accountType = trim((string)($input['account_type'] ?? 'checking'));
        $iban = !empty($input['iban']) ? trim(strtoupper(str_replace(' ', '', (string)$input['iban']))) : null;
        $openingDate = !empty($input['opening_date']) ? trim((string)$input['opening_date']) : null;
        $initialBalance = isset($input['initial_balance']) ? (float)$input['initial_balance'] : 0.0;

        $errors = [];

        // Validar banco existente en el catálogo
        if (!BankCatalog::find($bankId)) {
            $errors['bank_id'] = 'Debes seleccionar un banco válido de la lista.';
        }

        // Validar nombre
        if (mb_strlen($name) < 2 || mb_strlen($name) > 120) {
            $errors['name'] = 'El nombre de la cuenta debe tener entre 2 y 120 caracteres.';
        }

        // Validar tipo
        if (!in_array($accountType, ['checking', 'investment'], true)) {
            $errors['account_type'] = 'El tipo de cuenta debe ser "corriente" o "inversión".';
        }

        // Validar fecha si fue provista
        if ($openingDate !== null) {
            $d = \DateTime::createFromFormat('Y-m-d', $openingDate);
            if (!$d || $d->format('Y-m-d') !== $openingDate) {
                $errors['opening_date'] = 'El formato de fecha de apertura no es válido (YYYY-MM-DD).';
            }
        }

        // Validar formato de IBAN opcional si fue provisto
        if ($iban !== null) {
            if (strlen($iban) < 15 || strlen($iban) > 34 || !preg_match('/^[A-Z]{2}[0-9A-Z]{13,32}$/', $iban)) {
                $errors['iban'] = 'El formato de IBAN no parece válido (ej. ES91...).';
            }
        }

        if (!empty($errors)) {
            Response::error('Datos de cuenta inválidos.', 422, $errors);
        }

        // Asegurar que el banco exista en la tabla `banks` para respetar FK
        $bankMeta = BankCatalog::find($bankId);
        $insertBankStmt = $this->db->prepare('
            INSERT INTO banks (id, name, logo_code, color_hex)
            VALUES (:id, :name, :logo, :color)
            ON DUPLICATE KEY UPDATE name = VALUES(name), color_hex = VALUES(color_hex)
        ');
        $insertBankStmt->execute([
            'id' => $bankMeta['id'],
            'name' => $bankMeta['name'],
            'logo' => $bankMeta['id'],
            'color' => $bankMeta['color']
        ]);

        // Insertar la cuenta
        $stmt = $this->db->prepare('
            INSERT INTO accounts (user_id, bank_id, name, account_type, balance, initial_balance, iban, opening_date)
            VALUES (:user_id, :bank_id, :name, :account_type, :balance, :initial_balance, :iban, :opening_date)
        ');
        $stmt->execute([
            'user_id' => $userId,
            'bank_id' => $bankId,
            'name' => $name,
            'account_type' => $accountType,
            'balance' => $initialBalance,
            'initial_balance' => $initialBalance,
            'iban' => $iban,
            'opening_date' => $openingDate,
        ]);

        $newId = (int)$this->db->lastInsertId();

        Response::success('Cuenta creada exitosamente.', [
            'account' => [
                'id' => $newId,
                'bank_id' => $bankId,
                'name' => $name,
                'account_type' => $accountType,
                'balance' => $initialBalance,
                'iban' => $iban,
                'opening_date' => $openingDate,
            ]
        ], 201);
    }

    /**
     * Eliminar (desactivar) una cuenta
     */
    public function deleteAccount(int $id): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $stmt = $this->db->prepare('
            UPDATE accounts 
            SET is_active = 0 
            WHERE id = :id AND user_id = :user_id
        ');
        $stmt->execute(['id' => $id, 'user_id' => $userId]);

        if ($stmt->rowCount() === 0) {
            Response::error('Cuenta no encontrada o no autorizada.', 404);
        }

        Response::success('Cuenta eliminada correctamente.');
    }

    /**
     * Modificar una cuenta existente
     */
    public function updateAccount(int $id): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $input = $this->getJsonInput();

        $name = trim((string)($input['name'] ?? ''));
        $accountType = trim((string)($input['account_type'] ?? 'checking'));
        $iban = !empty($input['iban']) ? trim(strtoupper(str_replace(' ', '', (string)$input['iban']))) : null;
        $openingDate = !empty($input['opening_date']) ? trim((string)$input['opening_date']) : null;
        $hasBalance = isset($input['balance']);
        $balance = $hasBalance ? (float)$input['balance'] : null;
        $hasInitialBalance = isset($input['initial_balance']);

        $errors = [];

        // Validar nombre
        if (mb_strlen($name) < 2 || mb_strlen($name) > 120) {
            $errors['name'] = 'El nombre de la cuenta debe tener entre 2 y 120 caracteres.';
        }

        // Validar tipo
        if (!in_array($accountType, ['checking', 'investment'], true)) {
            $errors['account_type'] = 'El tipo de cuenta debe ser "corriente" o "inversión".';
        }

        // Validar fecha si fue provista
        if ($openingDate !== null) {
            $d = \DateTime::createFromFormat('Y-m-d', $openingDate);
            if (!$d || $d->format('Y-m-d') !== $openingDate) {
                $errors['opening_date'] = 'El formato de fecha de apertura no es válido (YYYY-MM-DD).';
            }
        }

        // Validar formato de IBAN opcional
        if ($iban !== null) {
            if (strlen($iban) < 15 || strlen($iban) > 34 || !preg_match('/^[A-Z]{2}[0-9A-Z]{13,32}$/', $iban)) {
                $errors['iban'] = 'El formato de IBAN no parece válido (ej. ES91...).';
            }
        }

        if (!empty($errors)) {
            Response::error('Datos de cuenta inválidos.', 422, $errors);
        }

        if ($hasBalance) {
            $stmt = $this->db->prepare('
                UPDATE accounts
                SET name = :name, account_type = :account_type, iban = :iban, opening_date = :opening_date, balance = :balance
                WHERE id = :id AND user_id = :user_id AND is_active = 1
            ');
            $stmt->execute([
                'name' => $name,
                'account_type' => $accountType,
                'iban' => $iban,
                'opening_date' => $openingDate,
                'balance' => $balance,
                'id' => $id,
                'user_id' => $userId
            ]);
        } else {
            $stmt = $this->db->prepare('
                UPDATE accounts
                SET name = :name, account_type = :account_type, iban = :iban, opening_date = :opening_date
                WHERE id = :id AND user_id = :user_id AND is_active = 1
            ');
            $stmt->execute([
                'name' => $name,
                'account_type' => $accountType,
                'iban' => $iban,
                'opening_date' => $openingDate,
                'id' => $id,
                'user_id' => $userId
            ]);
        }

        if ($hasInitialBalance) {
            $this->db->prepare('UPDATE accounts SET initial_balance = :initial WHERE id = :id AND user_id = :user_id AND is_active = 1')
                ->execute(['initial' => (float)$input['initial_balance'], 'id' => $id, 'user_id' => $userId]);
        }

        if ($stmt->rowCount() === 0) {
            // Verificar si existe para distinguir si no hubo cambios o no existe
            $check = $this->db->prepare('SELECT id FROM accounts WHERE id = :id AND user_id = :user_id AND is_active = 1');
            $check->execute(['id' => $id, 'user_id' => $userId]);
            if (!$check->fetch()) {
                Response::error('Cuenta no encontrada o no autorizada.', 404);
            }
        }

        Response::success('Cuenta actualizada correctamente.');
    }

    private function getJsonInput(): array
    {
        $raw = file_get_contents('php://input');
        $decoded = json_decode($raw ?: '{}', true);
        return is_array($decoded) ? $decoded : [];
    }
}
