using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Text.Json;

namespace IntelliStock.Api.Tests.Integration;

// D42: suppliers listed by how reachable they are, and a new product created and ordered in one step
[Trait("Category", "Integration")]
[Collection(ApiCollection.Name)]
public class NewProductTests(ApiFactory api)
{
    private static async Task<JsonElement> Json(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private async Task<HttpClient> NewOwner(string location)
    {
        var client = api.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/register", new
        {
            role = "BusinessOwner", fullName = "Fresh Owner", email = $"fresh-{Guid.NewGuid():N}@example.test",
            password = "long-enough-1", businessName = "Fresh Shop", location,
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", (await Json(response)).GetProperty("token").GetString());
        return client;
    }

    private static Dictionary<string, string> Reach(JsonElement suppliers) =>
        suppliers.EnumerateArray().ToDictionary(s => s.GetProperty("companyName").GetString()!, s => s.GetProperty("reach").GetString()!);

    [Fact]
    public async Task Suppliers_are_grouped_by_reach_and_other_provinces_are_left_out()
    {
        var nomvula = Reach(await Json(await (await api.LoginAs("nomvula@intellistock.test")).GetAsync("/api/suppliers")));
        Assert.Equal("inArea", nomvula["Ubuntu Wholesalers"]);    // delivers to Khayelitsha
        Assert.Equal("nearby", nomvula["Kasi Cash & Carry"]);     // Cape Flats, also Western Cape
        Assert.False(nomvula.ContainsKey("Mzansi Bulk Traders"));  // Tshwane only

        var sipho = Reach(await Json(await (await api.LoginAs("sipho@intellistock.test")).GetAsync("/api/suppliers")));
        Assert.Equal("inArea", sipho["Mzansi Bulk Traders"]);
        Assert.False(sipho.ContainsKey("Ubuntu Wholesalers"));

        var durban = Reach(await Json(await (await NewOwner("Umlazi, Durban")).GetAsync("/api/suppliers")));
        Assert.DoesNotContain("Ubuntu Wholesalers", durban.Keys);
        Assert.DoesNotContain("Kasi Cash & Carry", durban.Keys);
        Assert.DoesNotContain("Mzansi Bulk Traders", durban.Keys);
    }

    [Fact]
    public async Task A_new_product_is_created_at_zero_and_ordered_then_received_at_the_listing_unit_cost()
    {
        var owner = await NewOwner("Site C, Khayelitsha, Cape Town");

        var search = await Json(await owner.GetAsync("/api/listings/search?q=milk"));
        var options = search.GetProperty("options").EnumerateArray().ToList();
        Assert.NotEmpty(options);
        Assert.DoesNotContain(options, o => o.GetProperty("supplierName").GetString() == "Mzansi Bulk Traders");
        Assert.Equal(25, options[0].GetProperty("supplierListingId").GetInt32());   // Kasi, cheapest delivered
        var totals = options.Select(o => o.GetProperty("total").GetDecimal()).ToList();
        Assert.Equal(totals.OrderBy(t => t), totals);

        var placed = await owner.PostAsJsonAsync("/api/orders/new-product", new
        {
            name = "Clover Long Life Milk 1L", category = "Groceries", unit = "carton", reorderLevel = 6,
            sellingPrice = 18.99m, supplierListingId = 25, packs = 2,
        });
        Assert.Equal(HttpStatusCode.Created, placed.StatusCode);
        var body = await Json(placed);
        var itemId = body.GetProperty("item").GetProperty("stockItemId").GetInt32();
        var orderId = body.GetProperty("order").GetProperty("purchaseOrderId").GetInt32();
        Assert.Equal(itemId, body.GetProperty("order").GetProperty("stockItemId").GetInt32());

        var item = await Json(await owner.GetAsync($"/api/stock/{itemId}"));
        Assert.Equal(0, item.GetProperty("quantityOnHand").GetInt32());
        Assert.Equal(14.74m, item.GetProperty("unitCost").GetDecimal());   // R176.92 / 12

        var kasi = await api.LoginAs("sales@kasi-cashcarry.test");
        foreach (var status in new[] { "Confirmed", "Dispatched", "Delivered" })
            Assert.Equal(HttpStatusCode.OK,
                (await kasi.PostAsJsonAsync($"/api/supplier/orders/{orderId}/status", new { status })).StatusCode);

        var received = await owner.PostAsJsonAsync($"/api/orders/{orderId}/receive", new { });
        Assert.Equal(HttpStatusCode.OK, received.StatusCode);
        item = await Json(await owner.GetAsync($"/api/stock/{itemId}"));
        Assert.Equal(24, item.GetProperty("quantityOnHand").GetInt32());
        Assert.Equal(14.74m, item.GetProperty("unitCost").GetDecimal());
    }

    [Fact]
    public async Task Nothing_is_created_when_the_order_cannot_be_placed()
    {
        var owner = await NewOwner("Khayelitsha");
        var refused = await owner.PostAsJsonAsync("/api/orders/new-product", new
        {
            name = "Never Created Milk", category = "Groceries", unit = "each", reorderLevel = 1,
            sellingPrice = 10m, supplierListingId = 25, packs = 1000,
        });
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Empty((await Json(await owner.GetAsync("/api/stock"))).EnumerateArray());
    }
}
