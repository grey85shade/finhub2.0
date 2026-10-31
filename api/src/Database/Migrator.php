<?php
declare(strict_types=1);

namespace FinHub\Database;

use PDO;

/**
 * Migraciones versionadas: cada archivo database/migrations/NNN_nombre.sql se aplica una sola vez, en orden,
 * y queda anotado en la tabla schema_migrations.
 */
class Migrator
{
    private const DIR = __DIR__ . '/../../database/migrations';
    /** Migraciones que ya contenía una base creada antes de existir las migraciones (el antiguo schema.sql). */
    private const LEGACY_BASELINE = ['001_initial', '002_seed_categories'];

    public function __construct(private PDO $db)
    {
    }

    /** Aplica las migraciones pendientes y devuelve sus nombres. */
    public function migrate(): array
    {
        $this->db->query("SELECT GET_LOCK('finhub_migrate', 30)");
        try {
            $this->ensureTable();
            $applied = [];
            foreach ($this->pending() as $name => $file) {
                foreach (self::statements((string)file_get_contents($file)) as $sql) {
                    $this->db->exec($sql);
                }
                $this->db->prepare('INSERT INTO schema_migrations (version) VALUES (:v)')->execute(['v' => $name]);
                $applied[] = $name;
            }
            return $applied;
        } finally {
            $this->db->query("SELECT RELEASE_LOCK('finhub_migrate')");
        }
    }

    /** [nombre => ruta] de las migraciones que faltan por aplicar. */
    public function pending(): array
    {
        $done = $this->tableExists('schema_migrations')
            ? array_flip($this->db->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN))
            : [];
        $files = [];
        foreach (glob(self::DIR . '/*.sql') as $file) {
            $name = basename($file, '.sql');
            if (!isset($done[$name])) { $files[$name] = $file; }
        }
        ksort($files);
        return $files;
    }

    private function ensureTable(): void
    {
        if ($this->tableExists('schema_migrations')) { return; }
        $legacy = $this->tableExists('users');
        $this->db->exec('
            CREATE TABLE `schema_migrations` (
                `version` VARCHAR(100) PRIMARY KEY,
                `applied_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ');
        if ($legacy) {
            $stmt = $this->db->prepare('INSERT INTO schema_migrations (version) VALUES (:v)');
            foreach (self::LEGACY_BASELINE as $version) { $stmt->execute(['v' => $version]); }
        }
    }

    private function tableExists(string $table): bool
    {
        $stmt = $this->db->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :t');
        $stmt->execute(['t' => $table]);
        return (bool)$stmt->fetchColumn();
    }

    /** Separa un script en sentencias (una por cada «;» a final de línea), sin las líneas de comentario. */
    private static function statements(string $sql): array
    {
        $sql = preg_replace('/^\s*--.*$/m', '', str_replace("\r\n", "\n", $sql));
        return array_values(array_filter(array_map('trim', preg_split('/;\s*$/m', $sql)), fn ($s) => $s !== ''));
    }
}
