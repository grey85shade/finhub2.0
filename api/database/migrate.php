<?php
declare(strict_types=1);

/**
 * Aplica las migraciones pendientes desde la línea de comandos: php api/database/migrate.php
 * (la API también las aplica sola en la primera petición después de actualizar).
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

spl_autoload_register(function ($class) {
    $prefix = 'FinHub\\';
    if (strncmp($prefix, $class, strlen($prefix)) === 0) {
        $file = __DIR__ . '/../src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($file)) { require $file; }
    }
});

use FinHub\Config\AppConfig;
use FinHub\Database\Database;
use FinHub\Database\Migrator;

if (!AppConfig::installed()) {
    fwrite(STDERR, "FinHub no está instalado: abre la aplicación en el navegador para usar el asistente.\n");
    exit(1);
}

try {
    $applied = (new Migrator(Database::connect(AppConfig::get('db'))))->migrate();
    echo $applied ? 'Migraciones aplicadas: ' . implode(', ', $applied) . "\n" : "La base de datos ya está al día.\n";
} catch (\Throwable $e) {
    fwrite(STDERR, 'ERROR: ' . $e->getMessage() . "\n");
    exit(1);
}
