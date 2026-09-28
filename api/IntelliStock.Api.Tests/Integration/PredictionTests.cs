using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace IntelliStock.Api.Tests.Integration;

// FR-08: reorder prediction via ReorderPredictionService, and the ETR-03 fallbacks
[Trait("Category", "Integration")]
[Collection(ApiCollection.Name)]
public class PredictionTests(ApiFactory api) : IDisposable
{
    private const int MaizeMeal = 3;       // seeded, 120 days of history
    private const int NewSpaghetti = 22;   // seeded, added 14 Sep - under 30 days

    public void Dispose() => api.Model.Reset();

    private async Task<JsonElement> Predict(int id)
    {
        var client = await api.LoginAs("nomvula@intellistock.test");
        var response = await client.PostAsync($"/api/stock/{id}/prediction", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task Sends_the_model_60_days_of_daily_sales_oldest_first_from_the_transaction_log()
    {
        api.Model.Reset();
        await Predict(MaizeMeal);

        var sent = Assert.Single(api.Model.Requests);
        var sales = sent.GetProperty("dailySales").EnumerateArray().Select(v => v.GetDouble()).ToArray();
        Assert.Equal(60, sales.Length);
        Assert.Equal("Groceries", sent.GetProperty("category").GetString());
        Assert.Equal(DateTime.UtcNow.AddHours(2).ToString("yyyy-MM-dd"), sent.GetProperty("asOfDate").GetString());

        // the series is exactly the Sale rows of the 60 days before today, summed per day
        var expected = await ApiFactory.Scalar<double>(
            $"SELECT COALESCE(-SUM(QuantityChange), 0) FROM `Transaction` WHERE StockItemId = {MaizeMeal} " +
            "AND Type = 'Sale' AND OccurredAt >= DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 2 HOUR), INTERVAL 60 DAY) " +
            "AND OccurredAt < DATE(UTC_TIMESTAMP() + INTERVAL 2 HOUR)");
        Assert.Equal(expected, sales.Sum());
    }

    [Fact]
    public async Task A_confident_prediction_is_used_and_stock_out_days_are_derived_from_live_stock()
    {
        api.Model.Respond = _ => StubModelService.Confident(2.5, confidence: 0.82);
        var onHand = await ApiFactory.Scalar<int>($"SELECT QuantityOnHand FROM StockItem WHERE StockItemId = {MaizeMeal}");
        var level = await ApiFactory.Scalar<int>($"SELECT ReorderLevel FROM StockItem WHERE StockItemId = {MaizeMeal}");

        var p = await Predict(MaizeMeal);

        Assert.False(p.GetProperty("usedFallback").GetBoolean());
        Assert.Equal(JsonValueKind.Null, p.GetProperty("fallbackReason").ValueKind);
        Assert.Equal("model", p.GetProperty("recommendationSource").GetString());
        Assert.Equal("Model forecast (v1.1-relative), confidence 0.82", p.GetProperty("basis").GetString());
        Assert.Equal(2.5m, p.GetProperty("predictedDailyDemand").GetDecimal());
        Assert.Equal(0.82m, p.GetProperty("confidence").GetDecimal());
        Assert.Equal("v1.1-relative", p.GetProperty("modelVersion").GetString());
        // D17: computed by the API, not the model
        Assert.Equal(Math.Round(onHand / 2.5m, 1), p.GetProperty("daysUntilStockOut").GetDecimal());
        Assert.Equal((int)Math.Max(0, Math.Ceiling(2.5 * 7 + level - onHand)), p.GetProperty("recommendedQuantity").GetInt32());
    }

    [Fact]
    public async Task Low_confidence_falls_back_to_the_30_day_average_and_says_so()
    {
        api.Model.Respond = _ => StubModelService.Confident(9.9, confidence: 0.41);

        var p = await Predict(MaizeMeal);

        Assert.True(p.GetProperty("usedFallback").GetBoolean());
        Assert.Equal("lowConfidence", p.GetProperty("fallbackReason").GetString());
        Assert.Equal("thresholdBasedAdvice", p.GetProperty("recommendationSource").GetString());
        Assert.StartsWith("Threshold-based advice: 30-day average sales, because the model's confidence 0.41",
            p.GetProperty("basis").GetString());
        Assert.NotEqual(9.9m, p.GetProperty("predictedDailyDemand").GetDecimal());   // the model's number is not used
        Assert.Equal(0.41m, p.GetProperty("confidence").GetDecimal());                // but its confidence is kept
        var sent = Assert.Single(api.Model.Requests).GetProperty("dailySales").EnumerateArray().Select(v => v.GetDouble());
        Assert.Equal(Math.Round((decimal)sent.TakeLast(30).Average(), 3), p.GetProperty("predictedDailyDemand").GetDecimal());
    }

    [Fact]
    public async Task Model_422_insufficient_history_falls_back_for_a_new_item()
    {
        api.Model.Respond = _ => StubModelService.Json(HttpStatusCode.UnprocessableEntity, new { error = "insufficientHistory" });

        var p = await Predict(NewSpaghetti);

        Assert.True(p.GetProperty("usedFallback").GetBoolean());
        Assert.Equal("insufficientHistory", p.GetProperty("fallbackReason").GetString());
        Assert.Equal("thresholdBasedAdvice", p.GetProperty("recommendationSource").GetString());
        Assert.True(p.GetProperty("historyDays").GetInt32() < 30);
        Assert.Equal(JsonValueKind.Null, p.GetProperty("modelVersion").ValueKind);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    public async Task Model_errors_fall_back_rather_than_failing_the_owner(HttpStatusCode status)
    {
        api.Model.Respond = _ => StubModelService.Json(status, new { detail = "boom" });
        var p = await Predict(MaizeMeal);
        Assert.Equal("modelUnavailable", p.GetProperty("fallbackReason").GetString());
    }

    [Fact]
    public async Task Model_unreachable_falls_back_rather_than_failing_the_owner()
    {
        api.Model.Respond = _ => throw new HttpRequestException("connection refused");
        var p = await Predict(MaizeMeal);
        Assert.Equal("modelUnavailable", p.GetProperty("fallbackReason").GetString());
    }

    [Fact]
    public async Task Every_prediction_is_stored_and_the_latest_can_be_read_back()
    {
        api.Model.Respond = _ => StubModelService.Confident(4.25);
        var p = await Predict(MaizeMeal);
        var id = p.GetProperty("reorderPredictionId").GetInt32();

        var client = await api.LoginAs("nomvula@intellistock.test");
        var latest = await client.GetFromJsonAsync<JsonElement>($"/api/stock/{MaizeMeal}/prediction");

        Assert.Equal(id, latest.GetProperty("reorderPredictionId").GetInt32());
        Assert.Equal(4.25m, await ApiFactory.Scalar<decimal>(
            $"SELECT PredictedDailyDemand FROM ReorderPrediction WHERE ReorderPredictionId = {id}"));
    }
}
