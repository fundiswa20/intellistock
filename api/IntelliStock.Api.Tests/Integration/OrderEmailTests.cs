using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace IntelliStock.Api.Tests.Integration;

// D40: an email for each order status change, and a failed send never fails the order.
// Messages are found by order number, so tests running alongside do not interfere.
[Trait("Category", "Integration")]
[Collection(ApiCollection.Name)]
public class OrderEmailTests(ApiFactory api)
{
    private const string Owner = "nomvula@intellistock.test";
    private const string Supplier = "orders@ubuntu-wholesale.test";

    private static async Task<JsonElement> Json(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private async Task<(HttpClient Owner, HttpClient Supplier, int OrderId)> PlaceOrder(string product)
    {
        var supplier = await api.LoginAs(Supplier);
        var listing = await Json(await supplier.PostAsJsonAsync("/api/supplier/listings", new
        {
            productName = product, category = "Groceries", packSize = 12, packPrice = 120.00m,
            leadTimeDays = 2, availableQuantity = 10, deliveryCost = 50.00m, isActive = true,
        }));
        var owner = await api.LoginAs(Owner);
        var placed = await owner.PostAsJsonAsync("/api/orders", new
        {
            supplierListingId = listing.GetProperty("supplierListingId").GetInt32(), packs = 2,
        });
        Assert.Equal(HttpStatusCode.Created, placed.StatusCode);
        return (owner, supplier, (await Json(placed)).GetProperty("purchaseOrderId").GetInt32());
    }

    private List<IntelliStock.Api.Services.EmailMessage> For(int orderId) =>
        api.Email.Sent.Where(m => m.Subject.Contains($"#{orderId} ")).ToList();

    [Fact]
    public async Task Placing_emails_the_supplier_and_confirming_emails_the_owner()
    {
        var (_, supplier, id) = await PlaceOrder("Email Test Rooibos 80s");

        var placed = Assert.Single(For(id));
        Assert.Equal(Supplier, placed.To);
        Assert.Contains("Nomvula's Spaza", placed.Text);
        Assert.Contains("Email Test Rooibos 80s", placed.Text);
        Assert.Contains("2 packs of 12 (24 units)", placed.Text);
        Assert.Contains("R 290.00", placed.Text);                 // 2 x 120 + 50
        Assert.Contains("#18614a", placed.Html);                  // brand green header
        Assert.DoesNotContain("<img", placed.Html);
        Assert.DoesNotContain("<link", placed.Html);

        Assert.Equal(HttpStatusCode.OK,
            (await supplier.PostAsJsonAsync($"/api/supplier/orders/{id}/status", new { status = "Confirmed" })).StatusCode);
        var confirmed = For(id).Last();
        Assert.Equal(Owner, confirmed.To);
        Assert.Contains("Confirmed", confirmed.Text);
        Assert.Contains("Ubuntu Wholesalers", confirmed.Text);
        Assert.Contains("Expected delivery", confirmed.Text);
        Assert.Contains("2 days lead time", confirmed.Text);
    }

    [Fact]
    public async Task A_decline_goes_to_the_owner_and_a_cancel_to_the_supplier_with_the_reason()
    {
        var (_, supplier, declined) = await PlaceOrder("Email Test Declined Jam");
        await supplier.PostAsJsonAsync($"/api/supplier/orders/{declined}/status", new { status = "Declined", reason = "Out of jars" });
        var d = For(declined).Last();
        Assert.Equal(Owner, d.To);
        Assert.Contains("Out of jars", d.Text);

        var (owner, _, cancelled) = await PlaceOrder("Email Test Cancelled Jam");
        Assert.Equal(HttpStatusCode.OK,
            (await owner.PostAsJsonAsync($"/api/orders/{cancelled}/cancel", new { reason = "Found it cheaper" })).StatusCode);
        var c = For(cancelled).Last();
        Assert.Equal(Supplier, c.To);
        Assert.Contains("Cancelled", c.Text);
        Assert.Contains("Found it cheaper", c.Text);
    }

    [Fact]
    public async Task An_order_succeeds_when_email_cannot_be_sent()
    {
        api.Email.Fail = true;
        try
        {
            var (_, supplier, id) = await PlaceOrder("Email Test Offline Salt");   // asserts 201
            var confirm = await supplier.PostAsJsonAsync($"/api/supplier/orders/{id}/status", new { status = "Confirmed" });
            Assert.Equal(HttpStatusCode.OK, confirm.StatusCode);
            Assert.Equal("Confirmed", (await Json(confirm)).GetProperty("status").GetString());
            Assert.Empty(For(id));
        }
        finally { api.Email.Fail = false; }
    }
}
