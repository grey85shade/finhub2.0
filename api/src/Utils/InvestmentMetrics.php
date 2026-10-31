<?php
declare(strict_types=1);

namespace FinHub\Utils;

/**
 * Cálculos de rentabilidad de las cuentas de inversión.
 * Flujos de capital: el saldo inicial en la apertura, las aportaciones (income) y las retiradas (expense).
 * Las actualizaciones (update) solo cambian el valor, no el capital aportado.
 */
class InvestmentMetrics
{
    // Tramos de la base del ahorro del IRPF: [límite superior, tipo]
    private const SAVINGS_TAX_BRACKETS = [[6000, 0.19], [50000, 0.21], [200000, 0.23], [300000, 0.27], [PHP_FLOAT_MAX, 0.28]];
    // Por debajo de este plazo la TIR anualizada amplifica demasiado cualquier variación
    private const MIN_XIRR_DAYS = 90;

    /** Fecha de inicio de la inversión: la de apertura o la del primer movimiento. */
    public static function startDate(array $acc, array $txs): ?string
    {
        return $acc['opening_date'] ?? ($txs[0]['date'] ?? null);
    }

    /** Flujos de capital [fecha, importe] en orden cronológico; positivo = dinero que entra en la inversión. */
    public static function cashFlows(array $acc, array $txs): array
    {
        $flows = [];
        $start = self::startDate($acc, $txs);
        if ((float)$acc['initial_balance'] != 0 && $start) {
            $flows[] = [$start, (float)$acc['initial_balance']];
        }
        foreach ($txs as $tx) {
            if ($tx['type'] === 'income')  { $flows[] = [$tx['date'], abs((float)$tx['amount'])]; }
            if ($tx['type'] === 'expense') { $flows[] = [$tx['date'], -abs((float)$tx['amount'])]; }
        }
        return $flows;
    }

    /** Capital neto aportado hasta una fecha incluida. */
    public static function contributedAt(array $flows, string $date): float
    {
        $sum = 0.0;
        foreach ($flows as [$d, $amount]) {
            if ($d > $date) { break; }
            $sum += $amount;
        }
        return $sum;
    }

    /**
     * TIR anualizada (XIRR, ponderada por dinero) de una o varias inversiones, en %.
     * $flows: flujos [fecha, importe] de todas ellas; $value: su valor conjunto a $today.
     */
    public static function xirr(array $flows, float $value, \DateTimeImmutable $today): ?float
    {
        if (!$flows) { return null; }
        usort($flows, fn ($a, $b) => strcmp($a[0], $b[0]));
        $first = new \DateTimeImmutable($flows[0][0]);
        if ($first->diff($today)->days < self::MIN_XIRR_DAYS) { return null; }

        // Desde el punto de vista del inversor: aportar es un pago (negativo) y el valor final un cobro
        $points = [];
        foreach ($flows as [$d, $amount]) {
            $points[] = [(new \DateTimeImmutable($d))->diff($first)->days / 365.25, -$amount];
        }
        $points[] = [$today->diff($first)->days / 365.25, $value];

        $npv = function (float $rate) use ($points): float {
            $sum = 0.0;
            foreach ($points as [$t, $cf]) { $sum += $cf / (1 + $rate) ** $t; }
            return $sum;
        };

        // Bisección: robusta y suficiente para unos pocos cientos de flujos
        $lo = -0.9999;
        $hi = 10.0;
        $fLo = $npv($lo);
        if ($fLo * $npv($hi) > 0) { return null; }
        for ($i = 0; $i < 200 && $hi - $lo > 1e-9; $i++) {
            $mid = ($lo + $hi) / 2;
            $fMid = $npv($mid);
            if ($fLo * $fMid <= 0) { $hi = $mid; } else { $lo = $mid; $fLo = $fMid; }
        }
        return round(($lo + $hi) / 2 * 100, 2);
    }

    /**
     * Rentabilidad de un periodo por el método Modified Dietz, en %: la ganancia dividida entre el
     * capital medio invertido, ponderando cada aportación o retirada por el tiempo que estuvo dentro.
     */
    public static function modifiedDietz(float $startValue, float $endValue, array $flows, string $from, string $to): ?float
    {
        $fromDate = new \DateTimeImmutable($from);
        $days = $fromDate->diff(new \DateTimeImmutable($to))->days + 1;
        $net = 0.0;
        $weighted = 0.0;
        foreach ($flows as [$d, $amount]) {
            if ($d < $from || $d > $to) { continue; }
            $net += $amount;
            // Un flujo al inicio del periodo cuenta entero; uno el último día, casi nada
            $weighted += $amount * ($days - $fromDate->diff(new \DateTimeImmutable($d))->days) / $days;
        }
        $base = $startValue + $weighted;
        if ($base <= 0.005) { return null; }
        return round(($endValue - $startValue - $net) / $base * 100, 2);
    }

    /** Impuesto sobre una ganancia patrimonial con los tramos de la base del ahorro (las pérdidas no tributan). */
    public static function savingsTax(float $gain): float
    {
        $tax = 0.0;
        $lower = 0.0;
        foreach (self::SAVINGS_TAX_BRACKETS as [$upper, $rate]) {
            if ($gain <= $lower) { break; }
            $tax += (min($gain, $upper) - $lower) * $rate;
            $lower = $upper;
        }
        return $tax;
    }

    /**
     * Métricas por cuenta y totales de la cartera.
     * Los tramos del impuesto se aplican a la ganancia conjunta (las pérdidas de una cuenta compensan las
     * ganancias de otra) y el impuesto resultante se reparte entre las cuentas con plusvalía.
     * $txByAccount: movimientos de cada cuenta en orden cronológico.
     */
    public static function portfolio(array $accounts, array $txByAccount, \DateTimeImmutable $today): array
    {
        $items = [];
        $allFlows = [];
        $value = 0.0;
        $contributed = 0.0;
        $positiveGains = 0.0;

        foreach ($accounts as $acc) {
            $txs = $txByAccount[(int)$acc['id']] ?? [];
            $flows = self::cashFlows($acc, $txs);
            $balance = (float)$acc['balance'];
            $accContributed = array_sum(array_column($flows, 1));
            $gain = $balance - $accContributed;
            $start = self::startDate($acc, $txs);
            $years = $start ? (new \DateTimeImmutable($start))->diff($today)->days / 365.25 : null;

            $items[] = [
                'id' => (int)$acc['id'],
                'contributed' => round($accContributed, 2),
                'gain' => round($gain, 2),
                'gain_pct' => $accContributed > 0 ? round($gain / $accContributed * 100, 2) : null,
                'xirr' => self::xirr($flows, $balance, $today),
                'years' => $years !== null ? round($years, 2) : null,
                'start_date' => $start,
            ];
            array_push($allFlows, ...$flows);
            $value += $balance;
            $contributed += $accContributed;
            $positiveGains += max(0.0, $gain);
        }

        $gain = $value - $contributed;
        $tax = round(self::savingsTax($gain), 2);
        foreach ($items as $i => $item) {
            $share = $positiveGains > 0 ? max(0.0, $item['gain']) / $positiveGains : 0.0;
            $items[$i]['tax'] = round($tax * $share, 2);
        }

        return [
            'items' => $items,
            'totals' => [
                'value' => round($value, 2),
                'contributed' => round($contributed, 2),
                'gain' => round($gain, 2),
                'gain_pct' => $contributed > 0 ? round($gain / $contributed * 100, 2) : null,
                'xirr' => self::xirr($allFlows, $value, $today),
                'tax' => $tax,
                'net' => round($value - $tax, 2),
            ],
        ];
    }
}
