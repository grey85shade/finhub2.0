<?php
declare(strict_types=1);

namespace FinHub\Utils;

/**
 * Valores liquidativos de fondos desde Yahoo Finance (API pública no oficial, sin clave).
 * Un ISIN se resuelve a un símbolo de Yahoo (p. ej. IE00B03HCZ61 → 0P00000RQC.F) y con él se descarga el histórico diario.
 */
class FundPriceProvider
{
    private const SEARCH_URL = 'https://query2.finance.yahoo.com/v1/finance/search';
    private const CHART_URL = 'https://query2.finance.yahoo.com/v8/finance/chart/';
    private const TIMEOUT = 12;
    private const FUND_TYPES = ['MUTUALFUND', 'ETF'];

    /** Busca un fondo por ISIN. Devuelve ['symbol', 'name', 'currency'] o null si no se encuentra. */
    public static function lookup(string $isin): ?array
    {
        $json = self::get(self::SEARCH_URL . '?' . http_build_query(['q' => $isin, 'quotesCount' => 6, 'newsCount' => 0]));
        $quote = null;
        foreach ($json['quotes'] ?? [] as $q) {
            if (in_array($q['quoteType'] ?? '', self::FUND_TYPES, true) && !empty($q['symbol'])) { $quote = $q; break; }
        }
        if (!$quote) { return null; }

        // La moneda solo viene en los datos del gráfico
        $chart = self::get(self::CHART_URL . rawurlencode($quote['symbol']) . '?range=5d&interval=1d');
        $meta = $chart['chart']['result'][0]['meta'] ?? [];
        return [
            'symbol' => $quote['symbol'],
            'name' => $quote['longname'] ?? $meta['longName'] ?? $quote['shortname'] ?? $isin,
            'currency' => strtoupper($meta['currency'] ?? 'EUR'),
        ];
    }

    /** Valores liquidativos diarios desde una fecha: [Y-m-d => nav], en orden cronológico. */
    public static function history(string $symbol, string $from): array
    {
        $params = [
            'period1' => (new \DateTimeImmutable($from))->modify('-7 days')->getTimestamp(),
            'period2' => time() + 86400,
            'interval' => '1d',
        ];
        $json = self::get(self::CHART_URL . rawurlencode($symbol) . '?' . http_build_query($params));
        $result = $json['chart']['result'][0] ?? null;
        if (!$result) { throw new \RuntimeException("Sin datos de precios para {$symbol}."); }

        $tz = new \DateTimeZone($result['meta']['exchangeTimezoneName'] ?? 'Europe/Madrid');
        // El cierre sin ajustar es el valor liquidativo real al que se compraron las participaciones
        $closes = $result['indicators']['quote'][0]['close'] ?? [];
        $prices = [];
        foreach ($result['timestamp'] ?? [] as $i => $ts) {
            $nav = $closes[$i] ?? null;
            if ($nav === null || $nav <= 0) { continue; }
            $prices[(new \DateTimeImmutable("@$ts"))->setTimezone($tz)->format('Y-m-d')] = round((float)$nav, 6);
        }
        ksort($prices);
        return $prices;
    }

    private static function get(string $url): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => self::TIMEOUT,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (FinHub 2.0)',
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
        ]);
        // WAMP no trae almacén de certificados (curl.cainfo vacío): en Windows se usa el del sistema
        if (!ini_get('curl.cainfo') && defined('CURLSSLOPT_NATIVE_CA')) {
            curl_setopt($ch, CURLOPT_SSL_OPTIONS, CURLSSLOPT_NATIVE_CA);
        }
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($body === false || $status >= 400) {
            throw new \RuntimeException('El proveedor de precios no responde' . ($error ? ": {$error}" : " (HTTP {$status})") . '.');
        }
        $json = json_decode((string)$body, true);
        return is_array($json) ? $json : [];
    }
}
