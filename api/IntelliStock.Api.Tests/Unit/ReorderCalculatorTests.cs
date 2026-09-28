using IntelliStock.Api.Domain;
using static IntelliStock.Api.Domain.ReorderCalculator;

namespace IntelliStock.Api.Tests.Unit;

[Trait("Category", "Unit")]
public class ReorderCalculatorTests
{
    private static readonly DateOnly Mon21 = new(2026, 9, 21);

    [Fact]
    public void Daily_series_is_oldest_first_with_zeros_for_days_without_sales()
    {
        var sold = new Dictionary<DateOnly, int> { [Mon21] = 4, [Mon21.AddDays(2)] = 7 };
        Assert.Equal([4, 0, 7, 0], DailySeries(sold, Mon21, Mon21.AddDays(3)));
    }

    [Fact]
    public void Daily_series_is_empty_when_there_are_no_complete_days() =>
        Assert.Empty(DailySeries(new Dictionary<DateOnly, int>(), Mon21, Mon21.AddDays(-1)));

    [Fact]
    public void Fallback_demand_is_the_average_of_the_last_30_days()
    {
        // 10 days at 100 followed by 30 days at 3: only the last 30 count
        var series = Enumerable.Repeat(100.0, 10).Concat(Enumerable.Repeat(3.0, 30)).ToArray();
        Assert.Equal(3.0, FallbackDemand(series), 6);
    }

    [Fact]
    public void Fallback_demand_uses_what_history_exists_under_30_days() =>
        Assert.Equal(2.0, FallbackDemand([1, 2, 3]), 6);

    [Fact]
    public void Fallback_demand_is_zero_with_no_history() =>
        Assert.Equal(0.0, FallbackDemand([]));

    // D17: derived in the API from live stock

    [Fact]
    public void Days_until_stock_out_is_stock_on_hand_over_daily_demand() =>
        Assert.Equal(1.7m, DaysUntilStockOut(5, 2.867));

    [Fact]
    public void Days_until_stock_out_is_zero_for_an_empty_shelf() =>
        Assert.Equal(0m, DaysUntilStockOut(0, 22.3));

    [Fact]
    public void Days_until_stock_out_is_null_when_nothing_is_selling() =>
        Assert.Null(DaysUntilStockOut(12, 0));

    [Theory]
    [InlineData(2.867, 5, 4, 20)]   // 2.867 x 7 = 20.07 + 4 - 5 = 19.07 -> 20
    [InlineData(22.3, 0, 6, 163)]   // bread: 156.1 + 6 = 162.1 -> 163
    [InlineData(1.0, 50, 3, 0)]     // plenty on the shelf: never a negative order
    [InlineData(0, 1, 4, 3)]        // nothing selling: just top up to the reorder level
    public void Recommended_quantity_covers_a_week_of_demand_plus_the_reorder_level(
        double demand, int onHand, int reorderLevel, int expected) =>
        Assert.Equal(expected, RecommendedQuantity(demand, onHand, reorderLevel));

    [Fact]
    public void Days_since_restock_counts_from_the_last_restock_or_else_creation()
    {
        Assert.Equal(7, DaysSinceRestock(Mon21, new DateOnly(2026, 5, 31), Mon21.AddDays(7)));
        Assert.Equal(14, DaysSinceRestock(null, new DateOnly(2026, 9, 14), new DateOnly(2026, 9, 28)));
    }
}
