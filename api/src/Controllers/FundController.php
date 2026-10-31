<?php
declare(strict_types=1);

namespace FinHub\Controllers;

use FinHub\Database\Database;
use FinHub\Utils\FundPriceProvider;
use FinHub\Utils\FundValuation;
use FinHub\Utils\Response;
use PDO;

/**
 * Fondos indexados de las cuentas de inversión y sincronización de sus valores liquidativos.
 */
class FundController
{
    private PDO $db;
    private AuthController $authController;

    public function __construct()
    {
        $this->db = Database::getConnection();
        $this->authController = new AuthController();
    }

    /** Descarga precios y actualiza la valoración de las cuentas con fondos. ?force=1 ignora la caché. */
    public function sync(): void
    {
        $user = $this->authController->authenticate();
        $result = (new FundValuation($this->db))->syncUser((int)$user['id'], !empty($_GET['force']));
        Response::success('Precios sincronizados.', $result);
    }

    /** Valora con precios reales el cierre de cada mes pasado de la cuenta. */
    public function rebuildHistory(int $accountId): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];
        $this->findAccount($accountId, $userId);
        $replaceManual = !empty($this->getJsonInput()['replace_manual']);
        try {
            $months = (new FundValuation($this->db))->rebuildHistory($userId, $accountId, $replaceManual);
        } catch (\DomainException $e) {
            Response::error($e->getMessage(), 422);
        }
        if ($months === null) { Response::error('La cuenta no tiene fondos con precios.', 422); }
        Response::success("Histórico reconstruido: {$months} meses valorados.", ['months' => $months]);
    }

    public function createFund(int $accountId): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];
        $account = $this->findAccount($accountId, $userId);

        $input = $this->getJsonInput();
        $isin = strtoupper(preg_replace('/\s+/', '', (string)($input['isin'] ?? '')));
        $errors = $this->validate($input);
        if (!preg_match('/^[A-Z]{2}[A-Z0-9]{9}\d$/', $isin)) { $errors['isin'] = 'ISIN no válido (12 caracteres, p. ej. IE00B03HCZ61).'; }
        if ($errors) { Response::error('Datos inválidos.', 422, $errors); }

        $exists = $this->db->prepare('SELECT 1 FROM investment_funds WHERE account_id = :account_id AND isin = :isin');
        $exists->execute(['account_id' => $accountId, 'isin' => $isin]);
        if ($exists->fetchColumn()) { Response::error('Este fondo ya está en la cuenta.', 422, ['isin' => 'Fondo repetido.']); }

        try {
            $fund = FundPriceProvider::lookup($isin);
        } catch (\Throwable $e) {
            Response::error('No se pudo consultar el fondo: ' . $e->getMessage(), 502);
        }
        if (!$fund) { Response::error('No se ha encontrado ningún fondo con ese ISIN.', 422, ['isin' => 'ISIN no encontrado.']); }
        if ($fund['currency'] !== $account['currency']) {
            Response::error("El fondo cotiza en {$fund['currency']} y la cuenta está en {$account['currency']}.", 422, ['isin' => 'Moneda distinta a la de la cuenta.']);
        }

        $this->db->prepare('
            INSERT INTO investment_funds (user_id, account_id, isin, symbol, name, currency, weight, anchor_units, anchor_date)
            VALUES (:user_id, :account_id, :isin, :symbol, :name, :currency, :weight, :anchor_units, :anchor_date)
        ')->execute([
            'user_id' => $userId, 'account_id' => $accountId, 'isin' => $isin,
            'symbol' => $fund['symbol'], 'name' => mb_substr($fund['name'], 0, 160), 'currency' => $fund['currency'],
        ] + $this->fields($input));
        $id = (int)$this->db->lastInsertId();

        $sync = (new FundValuation($this->db))->syncUser($userId, false, [$accountId]);
        Response::success('Fondo añadido.', ['fund' => ['id' => $id, 'isin' => $isin] + $fund, 'sync' => $sync], 201);
    }

    public function updateFund(int $accountId, int $fundId): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];
        $this->findFund($fundId, $accountId, $userId);

        $input = $this->getJsonInput();
        if ($errors = $this->validate($input)) { Response::error('Datos inválidos.', 422, $errors); }
        $this->db->prepare('
            UPDATE investment_funds SET weight = :weight, anchor_units = :anchor_units, anchor_date = :anchor_date WHERE id = :id
        ')->execute(['id' => $fundId] + $this->fields($input));

        $sync = (new FundValuation($this->db))->syncUser($userId, false, [$accountId]);
        Response::success('Fondo actualizado.', ['sync' => $sync]);
    }

    public function deleteFund(int $accountId, int $fundId): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];
        $this->findFund($fundId, $accountId, $userId);

        $this->db->beginTransaction();
        try {
            // Sus aportaciones pasan a repartirse entre los fondos que queden
            $this->db->prepare('UPDATE transactions SET fund_id = NULL WHERE fund_id = :id')->execute(['id' => $fundId]);
            $this->db->prepare('DELETE FROM investment_funds WHERE id = :id')->execute(['id' => $fundId]);
            $this->db->commit();
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }

        $valuation = new FundValuation($this->db);
        // Sin fondos la cuenta vuelve a valorarse a mano: fuera las valoraciones calculadas
        if (!$valuation->fundsByAccount($userId, [$accountId])) { $valuation->removeAutoValuations($userId, $accountId); }
        $sync = $valuation->syncUser($userId, false, [$accountId]);
        Response::success('Fondo eliminado.', ['sync' => $sync]);
    }

    private function validate(array $input): array
    {
        $errors = [];
        $weight = $input['weight'] ?? 100;
        if (!is_numeric($weight) || $weight < 0 || $weight > 100) { $errors['weight'] = 'El peso debe estar entre 0 y 100.'; }

        $hasUnits = isset($input['anchor_units']) && $input['anchor_units'] !== '' && $input['anchor_units'] !== null;
        $hasDate = !empty($input['anchor_date']);
        if ($hasUnits !== $hasDate) { $errors['anchor_units'] = 'Indica a la vez las participaciones y su fecha.'; }
        if ($hasUnits && (!is_numeric($input['anchor_units']) || $input['anchor_units'] < 0)) { $errors['anchor_units'] = 'Participaciones no válidas.'; }
        if ($hasDate) {
            $date = \DateTime::createFromFormat('!Y-m-d', (string)$input['anchor_date']);
            if (!$date || $date->format('Y-m-d') !== $input['anchor_date'] || $input['anchor_date'] > date('Y-m-d')) {
                $errors['anchor_date'] = 'Fecha no válida (no puede ser futura).';
            }
        }
        return $errors;
    }

    private function fields(array $input): array
    {
        $hasAnchor = !empty($input['anchor_date']);
        return [
            'weight' => round((float)($input['weight'] ?? 100), 2),
            'anchor_units' => $hasAnchor ? round((float)$input['anchor_units'], 6) : null,
            'anchor_date' => $hasAnchor ? $input['anchor_date'] : null,
        ];
    }

    private function findAccount(int $accountId, int $userId): array
    {
        $stmt = $this->db->prepare("SELECT id, currency FROM accounts WHERE id = :id AND user_id = :user_id AND is_active = 1 AND account_type = 'investment'");
        $stmt->execute(['id' => $accountId, 'user_id' => $userId]);
        $account = $stmt->fetch();
        if (!$account) { Response::error('Cuenta de inversión no encontrada.', 404); }
        return $account;
    }

    private function findFund(int $fundId, int $accountId, int $userId): void
    {
        $stmt = $this->db->prepare('SELECT 1 FROM investment_funds WHERE id = :id AND account_id = :account_id AND user_id = :user_id');
        $stmt->execute(['id' => $fundId, 'account_id' => $accountId, 'user_id' => $userId]);
        if (!$stmt->fetchColumn()) { Response::error('Fondo no encontrado.', 404); }
    }

    private function getJsonInput(): array
    {
        $decoded = json_decode(file_get_contents('php://input') ?: '{}', true);
        return is_array($decoded) ? $decoded : [];
    }
}
