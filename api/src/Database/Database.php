<?php
declare(strict_types=1);

namespace FinHub\Database;

use FinHub\Config\AppConfig;
use FinHub\Utils\Response;
use PDO;
use PDOException;

class Database
{
    private static ?PDO $instance = null;

    public static function getConnection(): PDO
    {
        if (self::$instance === null) {
            if (!AppConfig::installed()) {
                Response::error('FinHub no está instalado.', 503, ['code' => 'not_installed']);
            }
            try {
                self::$instance = self::connect(AppConfig::get('db'));
            } catch (PDOException $e) {
                // Registro seguro de errores sin exponer credenciales al cliente
                error_log('Database Connection Error: ' . $e->getMessage());
                Response::error('No se pudo conectar con la base de datos.', 500);
            }
        }

        return self::$instance;
    }

    /** Abre una conexión con los datos indicados; sin 'database' se conecta al servidor (para crear la base). */
    public static function connect(array $db, bool $selectDatabase = true): PDO
    {
        $dsn = sprintf('mysql:host=%s;port=%d;charset=%s', $db['host'], (int)$db['port'], $db['charset'] ?? 'utf8mb4');
        if ($selectDatabase) {
            $dsn .= ';dbname=' . $db['database'];
        }
        return new PDO($dsn, $db['username'], $db['password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_TIMEOUT => 5,
        ]);
    }
}
