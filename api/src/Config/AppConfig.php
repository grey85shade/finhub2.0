<?php
declare(strict_types=1);

namespace FinHub\Config;

/**
 * Configuración de la aplicación: config/config.php (valores por defecto) + config/config.local.php (instalación).
 */
class AppConfig
{
    private static ?array $config = null;

    public static function all(): array
    {
        return self::$config ??= require __DIR__ . '/../../config/config.php';
    }

    public static function get(string $section): array
    {
        return self::all()[$section] ?? [];
    }

    public static function installed(): bool
    {
        return (bool)(self::all()['installed'] ?? false);
    }

    public static function localPath(): string
    {
        return __DIR__ . '/../../config/config.local.php';
    }

    /** Escribe config.local.php con los valores de la instalación y recarga la configuración. */
    public static function writeLocal(array $values): void
    {
        $content = "<?php\n// Configuración de esta instalación de FinHub, generada por el asistente. No la subas al repositorio.\n"
            . 'return ' . var_export($values, true) . ";\n";
        $path = self::localPath();
        $tmp = $path . '.tmp';
        if (file_put_contents($tmp, $content, LOCK_EX) === false || !rename($tmp, $path)) {
            @unlink($tmp);
            throw new \RuntimeException('No se pudo escribir ' . $path);
        }
        self::$config = null;
    }
}
