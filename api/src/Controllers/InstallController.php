<?php
declare(strict_types=1);

namespace FinHub\Controllers;

use FinHub\Config\AppConfig;
use FinHub\Database\Database;
use FinHub\Database\Migrator;
use FinHub\Utils\Response;
use PDO;
use PDOException;

/**
 * Estado público de la aplicación y asistente de la primera instalación: comprueba los requisitos, prueba la
 * conexión a la base de datos, crea las tablas, el administrador y config/config.local.php. Una vez instalada,
 * el asistente queda bloqueado.
 */
class InstallController
{
    public const VERSION = '1.0.0';
    private const MIN_PHP = '8.1.0';

    /** Lo que necesita saber el frontend antes de iniciar sesión. */
    public function status(): void
    {
        if (AppConfig::installed()) {
            Response::success('FinHub', [
                'installed' => true,
                'version' => self::VERSION,
                'allow_registration' => (bool)(AppConfig::get('app')['allow_registration'] ?? false),
            ]);
        }
        Response::success('FinHub no está instalado.', [
            'installed' => false,
            'version' => self::VERSION,
            'requirements' => $this->requirements(),
            'https' => $this->isHttps(),
        ]);
    }

    /** Prueba los datos de conexión sin guardar nada. */
    public function testDatabase(): void
    {
        $this->guard();
        $db = $this->dbInput($this->getJsonInput());
        try {
            $info = $this->inspect($db);
        } catch (PDOException $e) {
            Response::error($this->dbErrorMessage($e, $db), 422);
        }
        $message = match (true) {
            $info['existing_install'] => "Conexión correcta. La base de datos ya contiene FinHub con {$info['users']} usuario(s): se conservarán sus datos.",
            $info['database_exists'] => 'Conexión correcta. Se crearán las tablas en la base de datos.',
            default => 'Conexión correcta. La base de datos no existe: se creará.',
        };
        Response::success($message, $info);
    }

    public function install(): void
    {
        $this->guard();
        $input = $this->getJsonInput();
        $db = $this->dbInput($input);

        $settings = $input['settings'] ?? [];
        $timezone = (string)($settings['timezone'] ?? '');
        if (!in_array($timezone, \DateTimeZone::listIdentifiers(), true)) {
            Response::error('Zona horaria no válida.', 422, ['timezone' => 'Elige una zona horaria de la lista.']);
        }
        $failed = array_filter($this->requirements(), fn ($r) => $r['required'] && !$r['ok']);
        if ($failed) {
            Response::error('El servidor no cumple los requisitos: ' . implode(', ', array_column($failed, 'label')) . '.', 422);
        }

        try {
            $info = $this->inspect($db);
            if (!$info['database_exists']) {
                Database::connect($db, false)->exec(sprintf(
                    'CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', $db['database']
                ));
            }
            $pdo = Database::connect($db);
        } catch (PDOException $e) {
            Response::error($this->dbErrorMessage($e, $db), 422);
        }

        // Una base con usuarios es una instalación previa (p. ej. trasladada a otro servidor): se conserva tal cual
        $admin = null;
        if (!$info['existing_install']) {
            $admin = $this->adminInput($input['admin'] ?? []);
        }

        (new Migrator($pdo))->migrate();

        if ($admin) {
            $pdo->prepare("
                INSERT INTO users (name, email, password_hash, role, status) VALUES (:name, :email, :hash, 'admin', 'active')
            ")->execute(['name' => $admin['name'], 'email' => $admin['email'], 'hash' => AuthController::hashPassword($admin['password'])]);
        }

        AppConfig::writeLocal([
            'db' => [
                'host' => $db['host'],
                'port' => $db['port'],
                'database' => $db['database'],
                'username' => $db['username'],
                'password' => $db['password'],
            ],
            'app' => [
                'timezone' => $timezone,
                'allow_registration' => !empty($settings['allow_registration']),
            ],
            'security' => [
                'app_secret' => bin2hex(random_bytes(32)),
            ],
        ]);

        Response::success('FinHub se ha instalado correctamente.', ['existing_install' => $info['existing_install']], 201);
    }

    private function guard(): void
    {
        if (AppConfig::installed()) {
            Response::error('FinHub ya está instalado. Para reinstalarlo, borra api/config/config.local.php.', 403);
        }
    }

    private function requirements(): array
    {
        $configDir = dirname(AppConfig::localPath());
        return [
            ['key' => 'php', 'label' => 'PHP ' . self::MIN_PHP . ' o superior', 'ok' => version_compare(PHP_VERSION, self::MIN_PHP, '>='),
                'required' => true, 'detail' => 'Versión actual: ' . PHP_VERSION],
            ['key' => 'pdo_mysql', 'label' => 'Extensión pdo_mysql', 'ok' => extension_loaded('pdo_mysql'), 'required' => true,
                'detail' => 'Conexión con MySQL / MariaDB'],
            ['key' => 'mbstring', 'label' => 'Extensión mbstring', 'ok' => extension_loaded('mbstring'), 'required' => true,
                'detail' => 'Textos con acentos y caracteres especiales'],
            ['key' => 'curl', 'label' => 'Extensión curl', 'ok' => extension_loaded('curl'), 'required' => false,
                'detail' => 'Opcional: descarga de precios de fondos de inversión'],
            ['key' => 'config_writable', 'label' => 'Carpeta api/config con permiso de escritura', 'ok' => is_writable($configDir),
                'required' => true, 'detail' => 'El asistente guarda ahí config.local.php. Después puedes quitar el permiso.'],
        ];
    }

    private function isHttps(): bool
    {
        return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    }

    /** Si la base existe y si ya tiene una instalación de FinHub. */
    private function inspect(array $db): array
    {
        $server = Database::connect($db, false);
        $stmt = $server->prepare('SELECT 1 FROM information_schema.schemata WHERE schema_name = :name');
        $stmt->execute(['name' => $db['database']]);
        $exists = (bool)$stmt->fetchColumn();

        $users = 0;
        if ($exists) {
            $pdo = Database::connect($db);
            $hasUsers = $pdo->query("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'users'")->fetchColumn();
            if ($hasUsers) {
                $users = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
            }
        }
        return [
            'server' => $server->getAttribute(PDO::ATTR_SERVER_VERSION),
            'database_exists' => $exists,
            'existing_install' => $users > 0,
            'users' => $users,
        ];
    }

    private function dbInput(array $input): array
    {
        $db = $input['db'] ?? [];
        $values = [
            'host' => trim((string)($db['host'] ?? '')),
            'port' => (int)($db['port'] ?? 3306),
            'database' => trim((string)($db['database'] ?? '')),
            'username' => trim((string)($db['username'] ?? '')),
            'password' => (string)($db['password'] ?? ''),
            'charset' => 'utf8mb4',
        ];
        $errors = [];
        if ($values['host'] === '') { $errors['host'] = 'Indica el servidor.'; }
        if ($values['port'] < 1 || $values['port'] > 65535) { $errors['port'] = 'Puerto no válido.'; }
        // El nombre va dentro de un identificador SQL al crear la base: solo caracteres seguros
        if (!preg_match('/^[A-Za-z0-9_]{1,64}$/', $values['database'])) { $errors['database'] = 'Usa solo letras, números y guiones bajos.'; }
        if ($values['username'] === '') { $errors['username'] = 'Indica el usuario.'; }
        if ($errors) { Response::error('Revisa los datos de la base de datos.', 422, $errors); }
        return $values;
    }

    private function adminInput(array $admin): array
    {
        $name = trim((string)($admin['name'] ?? ''));
        $email = filter_var(trim((string)($admin['email'] ?? '')), FILTER_VALIDATE_EMAIL);
        $password = (string)($admin['password'] ?? '');
        $errors = [];
        if (mb_strlen($name) < 2) { $errors['name'] = 'El nombre debe tener al menos 2 caracteres.'; }
        if (!$email) { $errors['email'] = 'El correo electrónico no es válido.'; }
        if ($passwordError = AuthController::passwordError($password)) { $errors['password'] = $passwordError; }
        if ($errors) { Response::error('Revisa los datos del administrador.', 422, $errors); }
        return ['name' => $name, 'email' => $email, 'password' => $password];
    }

    private function dbErrorMessage(PDOException $e, array $db): string
    {
        error_log('Install DB error: ' . $e->getMessage());
        $code = (int)($e->errorInfo[1] ?? $e->getCode());
        return match ($code) {
            1045 => 'Usuario o contraseña de la base de datos incorrectos.',
            1044, 1142 => "El usuario «{$db['username']}» no tiene permisos suficientes sobre «{$db['database']}».",
            2002, 2003, 2005, 2006 => "No se puede conectar con {$db['host']}:{$db['port']}. Revisa el servidor y el puerto (en Synology, MariaDB 10 usa el 3307).",
            default => 'Error de la base de datos: ' . $e->getMessage(),
        };
    }

    private function getJsonInput(): array
    {
        $decoded = json_decode(file_get_contents('php://input') ?: '{}', true);
        return is_array($decoded) ? $decoded : [];
    }
}
