<?php
declare(strict_types=1);

namespace FinHub\Controllers;

use FinHub\Config\AppConfig;
use FinHub\Database\Database;
use FinHub\Utils\Response;
use PDO;

class AuthController
{
    private PDO $db;
    private array $config;

    public function __construct()
    {
        $this->db = Database::getConnection();
        $this->config = AppConfig::all();
    }

    /**
     * Registro seguro de nuevos usuarios
     */
    public function register(): void
    {
        if (empty($this->config['app']['allow_registration'])) {
            Response::error('El registro de nuevos usuarios está desactivado en esta instalación.', 403);
        }
        $input = $this->getJsonInput();

        $name = trim($input['name'] ?? '');
        $email = filter_var(trim($input['email'] ?? ''), FILTER_VALIDATE_EMAIL);
        $password = (string)($input['password'] ?? '');

        $errors = [];
        if (mb_strlen($name) < 2) {
            $errors['name'] = 'El nombre completo debe tener al menos 2 caracteres.';
        }
        if (!$email) {
            $errors['email'] = 'El formato de correo electrónico no es válido.';
        }
        
        if ($passwordError = self::passwordError($password)) {
            $errors['password'] = $passwordError;
        }

        if (!empty($errors)) {
            Response::error('Datos de registro inválidos.', 422, $errors);
        }

        // Verificar si el email ya existe
        $stmt = $this->db->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
        $stmt->execute(['email' => $email]);
        if ($stmt->fetch()) {
            Response::error('Este correo electrónico ya se encuentra registrado.', 409);
        }

        $passwordHash = self::hashPassword($password);

        $insertStmt = $this->db->prepare('
            INSERT INTO users (name, email, password_hash, status) 
            VALUES (:name, :email, :password_hash, "active")
        ');

        $success = $insertStmt->execute([
            'name' => htmlspecialchars($name, ENT_QUOTES, 'UTF-8'),
            'email' => $email,
            'password_hash' => $passwordHash,
        ]);

        if (!$success) {
            Response::error('No se pudo completar el registro. Intente de nuevo más tarde.', 500);
        }

        $userId = (int)$this->db->lastInsertId();

        // Generar sesión / token para auto-login tras registrarse
        $session = $this->createSession($userId);

        Response::success('Usuario registrado con éxito.', [
            'user' => [
                'id' => $userId,
                'name' => $name,
                'email' => $email,
                'role' => 'user',
            ],
            'token' => $session['raw_token'],
            'expires_at' => $session['expires_at'],
        ], 201);
    }

    /**
     * Inicio de sesión con mitigación contra fuerza bruta
     */
    public function login(): void
    {
        $input = $this->getJsonInput();

        $email = filter_var(trim($input['email'] ?? ''), FILTER_VALIDATE_EMAIL);
        $password = (string)($input['password'] ?? '');

        if (!$email || empty($password)) {
            Response::error('Por favor, ingresa tu correo y contraseña.', 400);
        }

        $stmt = $this->db->prepare('
            SELECT id, name, email, password_hash, role, status, failed_login_attempts, lockout_until 
            FROM users 
            WHERE email = :email 
            LIMIT 1
        ');
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch();

        if (!$user) {
            // Protección contra timing attacks
            password_verify($password, '$2y$12$e0MYNsm.wVzG1I.GgBqVse/19fV1LqgA3pW9M4mK7rC3mK0X1N2q.');
            Response::error('Credenciales de acceso incorrectas.', 401);
        }

        // Verificar bloqueo por intentos fallidos
        $now = date('Y-m-d H:i:s');
        if ($user['lockout_until'] && $user['lockout_until'] > $now) {
            Response::error('Tu cuenta está temporalmente bloqueada por seguridad. Inténtalo de nuevo más tarde.', 403);
        }

        if ($user['status'] !== 'active') {
            Response::error('Tu cuenta se encuentra inactiva o suspendida.', 403);
        }

        // Verificación de password
        if (!password_verify($password, $user['password_hash'])) {
            $maxAttempts = $this->config['security']['max_failed_attempts'] ?? 5;
            $newAttempts = $user['failed_login_attempts'] + 1;
            $lockoutUntil = null;

            if ($newAttempts >= $maxAttempts) {
                $lockMinutes = $this->config['security']['lockout_minutes'] ?? 15;
                $lockoutUntil = date('Y-m-d H:i:s', strtotime("+{$lockMinutes} minutes"));
            }

            $updateStmt = $this->db->prepare('
                UPDATE users 
                SET failed_login_attempts = :attempts, lockout_until = :lockout 
                WHERE id = :id
            ');
            $updateStmt->execute([
                'attempts' => $newAttempts,
                'lockout' => $lockoutUntil,
                'id' => $user['id'],
            ]);

            $remaining = max(0, $maxAttempts - $newAttempts);
            if ($lockoutUntil) {
                Response::error("Demasiados intentos fallidos. Tu cuenta ha sido bloqueada por 15 minutos.", 403);
            } else {
                Response::error("Credenciales de acceso incorrectas. Te quedan {$remaining} intentos.", 401);
            }
        }

        // Restablecer intentos fallidos tras login exitoso
        $resetStmt = $this->db->prepare('
            UPDATE users 
            SET failed_login_attempts = 0, lockout_until = NULL 
            WHERE id = :id
        ');
        $resetStmt->execute(['id' => $user['id']]);

        // Crear sesión y token de autenticación
        $session = $this->createSession((int)$user['id']);

        Response::success('Inicio de sesión exitoso.', [
            'user' => [
                'id' => (int)$user['id'],
                'name' => $user['name'],
                'email' => $user['email'],
                'role' => $user['role'],
            ],
            'token' => $session['raw_token'],
            'expires_at' => $session['expires_at'],
        ]);
    }

    /**
     * Obtener el perfil del usuario autenticado
     */
    public function me(): void
    {
        $user = $this->authenticate();
        Response::success('Usuario autenticado.', [
            'user' => [
                'id' => (int)$user['id'],
                'name' => $user['name'],
                'email' => $user['email'],
                'role' => $user['role'],
                'status' => $user['status'],
                'created_at' => $user['created_at'],
            ]
        ]);
    }

    /**
     * Cerrar sesión invalidando el token
     */
    public function logout(): void
    {
        if ($rawToken = self::bearerToken()) {
            $secret = $this->config['security']['app_secret'];
            $tokenHash = hash_hmac('sha256', $rawToken, $secret);

            $stmt = $this->db->prepare('DELETE FROM user_sessions WHERE token_hash = :hash');
            $stmt->execute(['hash' => $tokenHash]);
        }

        Response::success('Sesión finalizada exitosamente.');
    }

    /**
     * Valida el token Bearer recibido y retorna el usuario activo
     */
    public function authenticate(): array
    {
        $rawToken = self::bearerToken();
        if ($rawToken === null) {
            Response::error('No autorizado. Token no proporcionado.', 401);
        }

        $secret = $this->config['security']['app_secret'];
        $tokenHash = hash_hmac('sha256', $rawToken, $secret);

        $now = date('Y-m-d H:i:s');
        $stmt = $this->db->prepare('
            SELECT u.id, u.name, u.email, u.role, u.status, u.created_at, s.expires_at
            FROM user_sessions s
            INNER JOIN users u ON s.user_id = u.id
            WHERE s.token_hash = :hash AND s.expires_at > :now
            LIMIT 1
        ');
        $stmt->execute(['hash' => $tokenHash, 'now' => $now]);
        $user = $stmt->fetch();

        if (!$user) {
            Response::error('Token inválido o expirado.', 401);
        }

        if ($user['status'] !== 'active') {
            Response::error('Tu cuenta está suspendida o inactiva.', 403);
        }

        return $user;
    }

    /**
     * Genera un token criptográficamente seguro y almacena solo su HMAC sha256
     */
    private function createSession(int $userId): array
    {
        $rawToken = bin2hex(random_bytes(32)); // 64 caracteres hex
        $secret = $this->config['security']['app_secret'];
        $tokenHash = hash_hmac('sha256', $rawToken, $secret);

        $lifetime = $this->config['security']['session_lifetime_seconds'] ?? 604800;
        $expiresAt = date('Y-m-d H:i:s', time() + $lifetime);

        $ip = $_SERVER['REMOTE_ADDR'] ?? null;
        $ua = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255);

        $stmt = $this->db->prepare('
            INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
            VALUES (:user_id, :token_hash, :ip, :ua, :expires_at)
        ');
        $stmt->execute([
            'user_id' => $userId,
            'token_hash' => $tokenHash,
            'ip' => $ip,
            'ua' => $ua,
            'expires_at' => $expiresAt,
        ]);

        return [
            'raw_token' => $rawToken,
            'expires_at' => $expiresAt,
        ];
    }

    /** Política de contraseñas; null si es válida. */
    public static function passwordError(string $password): ?string
    {
        if (strlen($password) < 8) {
            return 'La contraseña debe tener mínimo 8 caracteres.';
        }
        if (!preg_match('/[A-Z]/', $password) || !preg_match('/[a-z]/', $password) || !preg_match('/[0-9]/', $password)) {
            return 'La contraseña debe incluir mayúsculas, minúsculas y números.';
        }
        return null;
    }

    public static function hashPassword(string $password): string
    {
        return password_hash($password, PASSWORD_BCRYPT, ['cost' => AppConfig::get('security')['bcrypt_cost'] ?? 12]);
    }

    /** Token Bearer de la petición. Con PHP-FPM la cabecera llega en $_SERVER (ver .htaccess), no en getallheaders(). */
    private static function bearerToken(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if ($header === '' && function_exists('getallheaders')) {
            $headers = array_change_key_case(getallheaders());
            $header = $headers['authorization'] ?? '';
        }
        return preg_match('/Bearer\s+(\S+)/', $header, $m) ? $m[1] : null;
    }

    private function getJsonInput(): array
    {
        $raw = file_get_contents('php://input');
        if (empty($raw)) {
            return [];
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }
}
