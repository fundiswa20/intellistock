namespace IntelliStock.Api.Domain;

// FR-08: the reorder arithmetic around the model's demand forecast, as pure functions.
public static class ReorderCalculator
{
    // days of sales history sent to the model service (it uses the last 31)
    public const int HistoryDays = 60;

    // how long a reorder should last: one weekly wholesaler cycle, matching the
    // model's 7-day forecast horizon
    public const int CoverDays = 7;

    // The daily sales series the model service expects: one value per day, oldest first,
    // from firstDay to lastDay inclusive, with 0 for days without a sale.
    public static double[] DailySeries(IReadOnlyDictionary<DateOnly, int> soldByDay, DateOnly firstDay, DateOnly lastDay)
    {
        if (lastDay < firstDay) return [];
        var n = lastDay.DayNumber - firstDay.DayNumber + 1;
        var series = new double[n];
        for (var i = 0; i < n; i++)
            series[i] = soldByDay.TryGetValue(firstDay.AddDays(i), out var q) ? q : 0;
        return series;
    }

    // ETR-03 fallback demand: the 30-day average - the same naive baseline the model was
    // evaluated against (D6). Uses what history exists when there is less than 30 days.
    public static double FallbackDemand(double[] series)
    {
        if (series.Length == 0) return 0;
        return series.TakeLast(30).Average();
    }

    // D17: derived in the API from live stock, not returned by the model service.
    // Null when nothing is selling, because the item will not run out.
    public static decimal? DaysUntilStockOut(int onHand, double dailyDemand) =>
        dailyDemand <= 0 ? null : Math.Round((decimal)(onHand / dailyDemand), 1);

    // Enough to cover CoverDays of forecast demand and still be above the reorder level
    // afterwards, less what is already on the shelf.
    public static int RecommendedQuantity(double dailyDemand, int onHand, int reorderLevel) =>
        Math.Max(0, (int)Math.Ceiling(dailyDemand * CoverDays + reorderLevel - onHand));

    // Days since the last restock, or since the item was created if it was never restocked.
    public static int DaysSinceRestock(DateOnly? lastRestock, DateOnly created, DateOnly asOf) =>
        Math.Max(0, asOf.DayNumber - (lastRestock ?? created).DayNumber);
}
