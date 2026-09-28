using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MySqlConnector;

namespace IntelliStock.Api.Tests.Integration;

// FR-04: stock movements and the immutable log. FR-05: low-stock alerts.
[Trait("Category", "Integration")]
[Collection(ApiCollection.Name)]
public class MovementAndAlertTests(ApiFactory api)
{
    private async Task<(HttpClient Client, int Id)> NewItem(string name, int opening, int reorderLevel)
    {
        var client = await api.LoginAs("nomvula@intellistock.test");
        var item = await (await client.PostAsJsonAsync("/api/stock", StockItemTests.NewItem(name, opening, reorderLevel)))
            .Content.ReadFromJsonAsync<JsonElement>();
        return (client, item.GetProperty("stockItemId").GetInt32());
    }

    private static async Task<JsonElement> Move(HttpClient client, int id, string type, int quantity, string? note = null)
    {
        var response = await client.PostAsJsonAsync($"/api/stock/{id}/movements", new { type, quantity, note });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task A_sale_reduces_stock_and_is_written_to_the_log_with_the_running_balance()
    {
        var (client, id) = await NewItem("Test Sale Item", opening: 30, reorderLevel: 5);

        var result = await Move(client, id, "Sale", 4);

        Assert.Equal(26, result.GetProperty("item").GetProperty("quantityOnHand").GetInt32());
        var t = result.GetProperty("transaction");
        Assert.Equal("Sale", t.GetProperty("type").GetString());
        Assert.Equal(-4, t.GetProperty("quantityChange").GetInt32());
        Assert.Equal(26, t.GetProperty("quantityAfter").GetInt32());
    }

    [Fact]
    public async Task Restock_and_adjustment_are_recorded_and_the_log_reads_newest_first()
    {
        var (client, id) = await NewItem("Test Restock Item", opening: 10, reorderLevel: 2);

        await Move(client, id, "Restock", 24, "Wholesaler trip");
        await Move(client, id, "Adjustment", -1, "Damaged tin");

        var log = await client.GetFromJsonAsync<JsonElement[]>($"/api/stock/{id}/movements");
        Assert.Equal(["Adjustment", "Restock", "Adjustment"], log!.Select(t => t.GetProperty("type").GetString()));
        Assert.Equal([33, 34, 10], log!.Select(t => t.GetProperty("quantityAfter").GetInt32()));
        Assert.Equal("Damaged tin", log![0].GetProperty("note").GetString());
    }

    [Fact]
    public async Task Selling_more_than_is_on_hand_is_refused_and_nothing_is_written()
    {
        var (client, id) = await NewItem("Test Oversell Item", opening: 3, reorderLevel: 1);

        var response = await client.PostAsJsonAsync($"/api/stock/{id}/movements", new { type = "Sale", quantity = 4 });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("only 3 in stock", await response.Content.ReadAsStringAsync());
        Assert.Equal(3, await ApiFactory.Scalar<int>($"SELECT QuantityOnHand FROM StockItem WHERE StockItemId = {id}"));
        Assert.Equal(1, await ApiFactory.Scalar<int>($"SELECT COUNT(*) FROM `Transaction` WHERE StockItemId = {id}"));
    }

    [Theory]
    [InlineData("Sale", 0)]
    [InlineData("Restock", -3)]
    [InlineData("Refund", 2)]
    public async Task Invalid_movements_are_rejected(string type, int quantity)
    {
        var (client, id) = await NewItem($"Test Invalid {type} {quantity}", opening: 10, reorderLevel: 1);
        var response = await client.PostAsJsonAsync($"/api/stock/{id}/movements", new { type, quantity });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task There_is_no_endpoint_to_edit_or_delete_a_movement()
    {
        var (client, id) = await NewItem("Test No Edit Item", opening: 10, reorderLevel: 1);
        var put = await client.PutAsJsonAsync($"/api/stock/{id}/movements", new { type = "Sale", quantity = 1 });
        var delete = await client.DeleteAsync($"/api/stock/{id}/movements");
        Assert.Equal(HttpStatusCode.MethodNotAllowed, put.StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, delete.StatusCode);
    }

    [Fact]
    public async Task The_database_itself_refuses_to_change_a_recorded_movement()
    {
        // FR-04 holds even if code bypasses the API: the triggers reject it (D19)
        var ex = await Assert.ThrowsAsync<MySqlException>(() =>
            ApiFactory.ExecSql("UPDATE `Transaction` SET QuantityChange = -1 ORDER BY TransactionId LIMIT 1"));
        Assert.Contains("FR-04", ex.Message);
        ex = await Assert.ThrowsAsync<MySqlException>(() =>
            ApiFactory.ExecSql("DELETE FROM `Transaction` ORDER BY TransactionId LIMIT 1"));
        Assert.Contains("FR-04", ex.Message);
    }

    [Fact]
    public async Task A_sale_that_reaches_the_reorder_level_raises_one_alert_and_a_restock_resolves_it()
    {
        var (client, id) = await NewItem("Test Alert Item", opening: 10, reorderLevel: 4);

        Assert.Equal(JsonValueKind.Null, (await Move(client, id, "Sale", 5)).GetProperty("alert").ValueKind);  // 5 left
        Assert.Equal("raised", (await Move(client, id, "Sale", 1)).GetProperty("alert").GetString());          // 4 = level
        Assert.Equal(JsonValueKind.Null, (await Move(client, id, "Sale", 2)).GetProperty("alert").ValueKind);  // no duplicate

        var open = await client.GetFromJsonAsync<JsonElement[]>("/api/stock/alerts");
        var alert = Assert.Single(open!, a => a.GetProperty("stockItemId").GetInt32() == id);
        Assert.Equal("Test Alert Item is down to 4 packets (reorder level 4)", alert.GetProperty("message").GetString());
        Assert.Equal(2, alert.GetProperty("currentQuantity").GetInt32());

        Assert.Equal("resolved", (await Move(client, id, "Restock", 20)).GetProperty("alert").GetString());
        open = await client.GetFromJsonAsync<JsonElement[]>("/api/stock/alerts");
        Assert.DoesNotContain(open!, a => a.GetProperty("stockItemId").GetInt32() == id);
    }

    [Fact]
    public async Task Raising_the_reorder_level_above_current_stock_raises_an_alert()
    {
        var (client, id) = await NewItem("Test Level Change Item", opening: 8, reorderLevel: 2);
        await client.PutAsJsonAsync($"/api/stock/{id}", StockItemTests.NewItem("Test Level Change Item", reorderLevel: 10));

        var open = await client.GetFromJsonAsync<JsonElement[]>("/api/stock/alerts");
        Assert.Contains(open!, a => a.GetProperty("stockItemId").GetInt32() == id);
    }

    [Fact]
    public async Task Owners_only_see_alerts_for_their_own_stock()
    {
        var sipho = await api.LoginAs("sipho@intellistock.test");
        var alerts = await sipho.GetFromJsonAsync<JsonElement[]>("/api/stock/alerts");
        Assert.NotEmpty(alerts!);   // the seed leaves Sipho with open alerts
        foreach (var id in alerts!.Select(a => a.GetProperty("stockItemId").GetInt32()))
            Assert.Equal(2, await ApiFactory.Scalar<int>($"SELECT BusinessOwnerId FROM StockItem WHERE StockItemId = {id}"));
    }
}
