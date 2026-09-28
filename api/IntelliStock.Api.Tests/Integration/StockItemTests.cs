using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace IntelliStock.Api.Tests.Integration;

// FR-03: stock item CRUD, scoped to the signed-in owner
[Trait("Category", "Integration")]
[Collection(ApiCollection.Name)]
public class StockItemTests(ApiFactory api)
{
    public static object NewItem(string name, int opening = 20, int reorderLevel = 5, string category = "Groceries") => new
    {
        name, category, unit = "packet", reorderLevel, unitCost = 10.00m, sellingPrice = 13.99m,
        openingQuantity = opening,
    };

    [Fact]
    public async Task Owner_sees_only_their_own_seeded_stock()
    {
        var nomvula = await api.LoginAs("nomvula@intellistock.test");
        var items = await nomvula.GetFromJsonAsync<JsonElement[]>("/api/stock");

        Assert.Contains(items!, i => i.GetProperty("name").GetString() == "Iwisa Super Maize Meal 5kg");
        Assert.True(items!.Length >= 22);
        foreach (var id in items!.Select(i => i.GetProperty("stockItemId").GetInt32()))
            Assert.Equal(1, await ApiFactory.Scalar<int>($"SELECT BusinessOwnerId FROM StockItem WHERE StockItemId = {id}"));
    }

    [Fact]
    public async Task Another_owners_item_answers_404_not_403()
    {
        var sipho = await api.LoginAs("sipho@intellistock.test");
        Assert.Equal(HttpStatusCode.NotFound, (await sipho.GetAsync("/api/stock/3")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await sipho.PostAsJsonAsync("/api/stock/3/movements",
            new { type = "Sale", quantity = 1 })).StatusCode);
    }

    [Fact]
    public async Task Creating_an_item_records_its_opening_stock_in_the_transaction_log()
    {
        var client = await api.LoginAs("nomvula@intellistock.test");
        var response = await client.PostAsJsonAsync("/api/stock", NewItem("Test Mielie Rice 1kg", opening: 20));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var item = await response.Content.ReadFromJsonAsync<JsonElement>();
        var id = item.GetProperty("stockItemId").GetInt32();
        Assert.Equal(20, item.GetProperty("quantityOnHand").GetInt32());

        var log = await client.GetFromJsonAsync<JsonElement[]>($"/api/stock/{id}/movements");
        var opening = Assert.Single(log!);
        Assert.Equal("Adjustment", opening.GetProperty("type").GetString());
        Assert.Equal(20, opening.GetProperty("quantityChange").GetInt32());
        Assert.Equal("Opening stock count", opening.GetProperty("note").GetString());
    }

    [Fact]
    public async Task Updating_an_item_changes_its_details_but_never_its_quantity()
    {
        var client = await api.LoginAs("nomvula@intellistock.test");
        var created = await (await client.PostAsJsonAsync("/api/stock", NewItem("Test Samp 2kg", opening: 12)))
            .Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("stockItemId").GetInt32();

        var response = await client.PutAsJsonAsync($"/api/stock/{id}", NewItem("Test Samp 2kg (Iwisa)", opening: 999));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Test Samp 2kg (Iwisa)", updated.GetProperty("name").GetString());
        Assert.Equal(12, updated.GetProperty("quantityOnHand").GetInt32());   // unchanged: FR-04
    }

    [Fact]
    public async Task A_category_the_model_does_not_know_is_rejected()
    {
        var client = await api.LoginAs("nomvula@intellistock.test");
        var response = await client.PostAsJsonAsync("/api/stock", NewItem("Test Airtime R10", category: "Airtime"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Category must be one of", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Invalid_input_is_rejected_with_a_validation_problem()
    {
        var client = await api.LoginAs("nomvula@intellistock.test");
        var response = await client.PostAsJsonAsync("/api/stock", new
        {
            name = "", category = "Groceries", unit = "each", reorderLevel = -1, unitCost = 1m, sellingPrice = 2m,
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Deleting_an_item_hides_it_but_keeps_its_history()
    {
        var client = await api.LoginAs("nomvula@intellistock.test");
        var created = await (await client.PostAsJsonAsync("/api/stock", NewItem("Test Discontinued Snack", opening: 6)))
            .Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("stockItemId").GetInt32();

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/stock/{id}")).StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/stock/{id}")).StatusCode);
        var list = await client.GetFromJsonAsync<JsonElement[]>("/api/stock");
        Assert.DoesNotContain(list!, i => i.GetProperty("stockItemId").GetInt32() == id);
        // D20: soft delete - the row and its transaction log are still in the database
        Assert.Equal(0, await ApiFactory.Scalar<int>($"SELECT IsActive FROM StockItem WHERE StockItemId = {id}"));
        Assert.Equal(1, await ApiFactory.Scalar<int>($"SELECT COUNT(*) FROM `Transaction` WHERE StockItemId = {id}"));
    }
}
