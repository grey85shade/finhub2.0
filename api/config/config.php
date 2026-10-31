<?php
declare(strict_types=1);

/**
 * FinHub - Configuración por defecto.
 *
 * No edites este archivo: los valores de cada instalación (base de datos, secreto, zona horaria...) los escribe el
 * asistente de instalación en config.local.php, que no se sube al repositorio. Si config.local.php no existe, la
 * aplicación se considera sin instalar y muestra el asistente.
 */

$defaults = [
    'db' => [
        'host' => '127.0.0.1',
        'port' => 3306,
        'database' => 'finhub',
        'username' => '',
        'password' => '',
        'charset' => 'utf8mb4',
    ],
    'app' => [
        'timezone' => 'Europe/Madrid',
        // Si está desactivado, solo existen las cuentas que cree el administrador
        'allow_registration' => false,
    ],
    'security' => [
        // Clave para el HMAC de los tokens de sesión; la genera el instalador
        'app_secret' => '',
        'session_lifetime_seconds' => 86400 * 7, // 7 días
        'max_failed_attempts' => 5,
        'lockout_minutes' => 15,
        'bcrypt_cost' => 12,
    ],
    'cors' => [
        // Solo hace falta si el frontend se sirve desde otro origen que la API (p. ej. el servidor de Vite sin proxy)
        'allowed_origins' => [],
        'allowed_methods' => ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        'allowed_headers' => ['Content-Type', 'Authorization', 'X-Requested-With'],
    ],
];

$localFile = __DIR__ . '/config.local.php';
$local = is_file($localFile) ? require $localFile : [];

return array_replace_recursive($defaults, is_array($local) ? $local : []) + ['installed' => is_file($localFile)];
