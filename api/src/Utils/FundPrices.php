<?php
declare(strict_types=1);

namespace FinHub\Utils;

use PDO;

/**
 * Caché en base de datos de los valores liquidativos. Solo se consulta al proveedor si los datos de un
 * símbolo tienen más de unas horas o si se necesita histórico anterior al ya descargado.
 */
class FundPrices
{
    private const REFRESH_HOURS = 6;

    public function __construct(private PDO $db) {}

    /**
     * Asegura que hay precios de $symbol desde $from hasta hoy. Devuelve null o el error del proveedor;
     * si falla, se sigue trabajando con los precios ya guardados.
     */
    public function refresh(string $symbol, string $from, bool $force = false): ?string
    {
        $stmt = $this->db->prepare('SELECT fetched_at, history_from FROM fund_price_syncs WHERE symbol = :symbol');
        $stmt->execute(['symbol' => $symbol]);
        $sync = $stmt->fetch();

        $needsHistory = !$sync || $sync['history_from'] === null || $sync['history_from'] > $from;
        $stale = !$sync || strtotime($sync['fetched_at']) < time() - self::REFRESH_HOURS * 3600;
        if (!$needsHistory && !$stale && !$force) { return null; }

        // Sin histórico pendiente basta con las últimas semanas
        $fetchFrom = $needsHistory ? $from : (new \DateTimeImmutable('today'))->modify('-30 days')->format('Y-m-d');
        try {
            $prices = FundPriceProvider::history($symbol, $fetchFrom);
        } catch (\Throwable $e) {
            return $e->getMessage();
        }

        $insert = $this->db->prepare('INSERT INTO fund_prices (symbol, date, nav) VALUES (:symbol, :date, :nav) ON DUPLICATE KEY UPDATE nav = VALUES(nav)');
        foreach ($prices as $date => $nav) {
            $insert->execute(['symbol' => $symbol, 'date' => $date, 'nav' => $nav]);
        }
        $historyFrom = $needsHistory ? $fetchFrom : $sync['history_from'];
        $this->db->prepare('
            INSERT INTO fund_price_syncs (symbol, fetched_at, history_from) VALUES (:symbol, NOW(), :history_from)
            ON DUPLICATE KEY UPDATE fetched_at = NOW(), history_from = VALUES(history_from)
        ')->execute(['symbol' => $symbol, 'history_from' => $historyFrom]);
        return null;
    }

    /** Precios guardados de varios símbolos: [symbol => [Y-m-d => nav]] en orden cronológico. */
    public function load(array $symbols): array
    {
        $symbols = array_values(array_unique($symbols));
        if (!$symbols) { return []; }
        $in = implode(',', array_fill(0, count($symbols), '?'));
        $stmt = $this->db->prepare("SELECT symbol, date, nav FROM fund_prices WHERE symbol IN ($in) ORDER BY date ASC");
        $stmt->execute($symbols);
        $result = array_fill_keys($symbols, []);
        foreach ($stmt->fetchAll() as $row) {
            $result[$row['symbol']][$row['date']] = (float)$row['nav'];
        }
        return $result;
    }

    /**
     * Valor liquidativo aplicable a una fecha: el último publicado hasta ese día, o el primero posterior
     * si la fecha es anterior a todo el histórico. Devuelve [fecha del precio, nav] o null.
     */
    public static function navOn(array $prices, string $date): ?array
    {
        $found = null;
        foreach ($prices as $d => $nav) {
            if ($d > $date) { return $found ?? [$d, $nav]; }
            $found = [$d, $nav];
        }
        return $found;
    }
}
