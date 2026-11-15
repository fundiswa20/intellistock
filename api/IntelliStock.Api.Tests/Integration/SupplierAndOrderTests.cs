using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace IntelliStock.Api.Tests.Integration;

// FR-01 registration, FR-06/07 supplier listings, FR-10 orders, FR-05 resolved alerts (D37).
// Each test creates its own listing so it does not depend on the order tests run in.
[Trait("Category", "Integration")]
[Collection(ApiCollection.Name)]
public class SupplierAndOrderTests(ApiFactory api)
{
    private const string Owner = "nomvula@intellistock.test";
    private const string Supplier = "orders@ubuntu-wholesale.test";

    private static object Listing(string name, int available = 10, bool active = true) => new
    {
        productName = name, category = "Groceries", packSize = 12, packPrice = 120.00m,
        leadTimeDays = 1, availableQuantity = available, deliveryCost = 50.00m, isActive = active,
    };

    private async Task<(HttpClient Supplier, int ListingId)> NewListing(string name, int available = 10)
    {
        var supplier = await api.LoginAs(Supplier);
        var response = await supplier.PostAsJsonAsync("/api/supplier/listings", Listing(name, available));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (supplier, (await Json(response)).GetProperty("supplierListingId").GetInt32());
    }

    private static async Task<JsonElement> Json(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<int> Available(HttpClient supplier, int listingId) =>
        (await Json(await supplier.GetAsync("/api/supplier/listings"))).EnumerateArray()
            .Single(l => l.GetProperty("supplierListingId").GetInt32() == listingId)
            .GetProperty("availableQuantity").GetInt32();

    // ------------------------------------------------------------------ FR-01

    [Theory]
    [InlineData("BusinessOwner")]
    [InlineData("Supplier")]
    public async Task A_new_user_registers_and_is_signed_in_with_their_role(string role)
    {
        var email = $"new-{role.ToLower()}-{Guid.NewGuid():N}@example.test";
        var response = await api.CreateClient().PostAsJsonAsync("/api/auth/register", new
        {
            role, fullName = "Thandi Test", email, password = "long-enough-1",
            businessName = "Thandi's Shop", location = "Langa", companyName = "Thandi Wholesale",
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var user = (await Json(response)).GetProperty("user");
        Assert.Equal(role, user.GetProperty("role").GetString());

        var login = await api.CreateClient().PostAsJsonAsync("/api/auth/login", new { email, password = "long-enough-1" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [Fact]
    public async Task Registering_a_taken_email_is_refused()
    {
        var response = await api.CreateClient().PostAsJsonAsync("/api/auth/register", new
        {
            role = "BusinessOwner", fullName = "Someone", email = Owner, password = "long-enough-1",
            businessName = "Shop", location = "Here",
        });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task An_owner_must_give_a_shop_name()
    {
        var response = await api.CreateClient().PostAsJsonAsync("/api/auth/register", new
        {
            role = "BusinessOwner", fullName = "Someone", email = $"x-{Guid.NewGuid():N}@example.test",
            password = "long-enough-1", location = "Here",
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ------------------------------------------------------------------ FR-06 / FR-07

    [Fact]
    public async Task An_inactive_listing_is_hidden_from_owners()
    {
        var name = $"Hidden Test Product {Guid.NewGuid():N}";
        var (supplier, id) = await NewListing(name);
        var owner = await api.LoginAs(Owner);

        Assert.Contains(name, await (await owner.GetAsync($"/api/listings?q={name}")).Content.ReadAsStringAsync());
        await supplier.PutAsJsonAsync($"/api/supplier/listings/{id}", Listing(name, active: false));
        Assert.DoesNotContain(name, await (await owner.GetAsync($"/api/listings?q={name}")).Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_supplier_cannot_edit_another_suppliers_listing()
    {
        var (_, id) = await NewListing("Ubuntu Only Test Product");
        var other = await api.LoginAs("sales@kasi-cashcarry.test");
        var response = await other.PutAsJsonAsync($"/api/supplier/listings/{id}", Listing("Taken over"));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Owners_and_suppliers_are_kept_to_their_own_endpoints()
    {
        var owner = await api.LoginAs(Owner);
        var supplier = await api.LoginAs(Supplier);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.GetAsync("/api/supplier/orders")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await supplier.GetAsync("/api/orders")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await supplier.GetAsync("/api/listings")).StatusCode);
    }

    // ------------------------------------------------------------------ FR-10

    [Fact]
    public async Task An_order_runs_from_placed_to_received_and_restocks_the_item()
    {
        var (supplier, listingId) = await NewListing("Order Flow Test Milk");
        var owner = await api.LoginAs(Owner);
        var item = await Json(await owner.PostAsJsonAsync("/api/stock", StockItemTests.NewItem("Order Flow Test Milk", 5, 2)));
        var itemId = item.GetProperty("stockItemId").GetInt32();

        var placed = await owner.PostAsJsonAsync("/api/orders", new { supplierListingId = listingId, packs = 3, stockItemId = itemId });
        Assert.Equal(HttpStatusCode.Created, placed.StatusCode);
        var order = await Json(placed);
        var orderId = order.GetProperty("purchaseOrderId").GetInt32();
        Assert.Equal(3 * 120.00m + 50.00m, order.GetProperty("total").GetDecimal());
        Assert.Equal(7, await Available(supplier, listingId));

        // the supplier sees it with the shop's details, and moves it along
        var seen = await Json(await supplier.GetAsync($"/api/supplier/orders/{orderId}"));
        Assert.Equal("Nomvula's Spaza", seen.GetProperty("owner").GetProperty("name").GetString());
        foreach (var status in new[] { "Confirmed", "Dispatched", "Delivered" })
            Assert.Equal(HttpStatusCode.OK,
                (await supplier.PostAsJsonAsync($"/api/supplier/orders/{orderId}/status", new { status })).StatusCode);

        var received = await owner.PostAsJsonAsync($"/api/orders/{orderId}/receive", new { });
        Assert.Equal(HttpStatusCode.OK, received.StatusCode);
        Assert.Equal(5 + 36, (await Json(received)).GetProperty("quantityOnHand").GetInt32());

        // once only
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync($"/api/orders/{orderId}/receive", new { })).StatusCode);
        var log = await Json(await owner.GetAsync($"/api/stock/{itemId}/movements"));
        Assert.Equal($"Order #{orderId} from Ubuntu Wholesalers", log[0].GetProperty("note").GetString());
    }

    [Fact]
    public async Task Ordering_more_packs_than_are_available_is_refused()
    {
        var (_, listingId) = await NewListing("Scarce Test Product", available: 2);
        var owner = await api.LoginAs(Owner);
        var response = await owner.PostAsJsonAsync("/api/orders", new { supplierListingId = listingId, packs = 3 });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("The supplier has only 2 packs available.", (await Json(response)).GetProperty("title").GetString());
    }

    [Fact]
    public async Task Cancelling_or_declining_gives_the_packs_back()
    {
        var (supplier, listingId) = await NewListing("Returned Test Product", available: 10);
        var owner = await api.LoginAs(Owner);

        var first = (await Json(await owner.PostAsJsonAsync("/api/orders", new { supplierListingId = listingId, packs = 4 })))
            .GetProperty("purchaseOrderId").GetInt32();
        var second = (await Json(await owner.PostAsJsonAsync("/api/orders", new { supplierListingId = listingId, packs = 2 })))
            .GetProperty("purchaseOrderId").GetInt32();
        Assert.Equal(4, await Available(supplier, listingId));

        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsync($"/api/orders/{first}/cancel", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await supplier.PostAsJsonAsync($"/api/supplier/orders/{second}/status", new { status = "Declined" })).StatusCode);
        Assert.Equal(10, await Available(supplier, listingId));
    }

    [Fact]
    public async Task A_confirmed_order_cannot_be_cancelled_and_a_supplier_cannot_skip_ahead()
    {
        var (supplier, listingId) = await NewListing("Locked Test Product");
        var owner = await api.LoginAs(Owner);
        var id = (await Json(await owner.PostAsJsonAsync("/api/orders", new { supplierListingId = listingId, packs = 1 })))
            .GetProperty("purchaseOrderId").GetInt32();

        Assert.Equal(HttpStatusCode.Conflict,
            (await supplier.PostAsJsonAsync($"/api/supplier/orders/{id}/status", new { status = "Delivered" })).StatusCode);
        await supplier.PostAsJsonAsync($"/api/supplier/orders/{id}/status", new { status = "Confirmed" });
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsync($"/api/orders/{id}/cancel", null)).StatusCode);
    }

    [Fact]
    public async Task Another_owners_order_is_not_found()
    {
        var (_, listingId) = await NewListing("Private Order Test Product");
        var owner = await api.LoginAs(Owner);
        var id = (await Json(await owner.PostAsJsonAsync("/api/orders", new { supplierListingId = listingId, packs = 1 })))
            .GetProperty("purchaseOrderId").GetInt32();

        var sipho = await api.LoginAs("sipho@intellistock.test");
        Assert.Equal(HttpStatusCode.NotFound, (await sipho.GetAsync($"/api/orders/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await sipho.PostAsync($"/api/orders/{id}/cancel", null)).StatusCode);
    }

    // ------------------------------------------------------------------ D39 restocking comparison

    [Fact]
    public async Task Restocking_an_item_compares_every_supplier_of_it_cheapest_delivered_first()
    {
        var owner = await api.LoginAs(Owner);
        // item 8 is Nomvula's Clover Long Life Milk 1L; the seed lists it at all three suppliers,
        // and her last milk order (seed order 5) was from Ubuntu Wholesalers (3)
        var r = await Json(await owner.GetAsync("/api/stock/8/suppliers?units=24"));
        Assert.Equal("milk", r.GetProperty("searchTerm").GetString());
        Assert.Equal(3, r.GetProperty("lastSupplier").GetProperty("supplierId").GetInt32());

        var options = r.GetProperty("options").EnumerateArray().ToList();
        var ubuntu = options.Single(o => o.GetProperty("supplierListingId").GetInt32() == 6);
        var kasi = options.Single(o => o.GetProperty("supplierListingId").GetInt32() == 25);
        Assert.True(options.IndexOf(kasi) < options.IndexOf(ubuntu));   // R176.92 a pack against R196.22
        Assert.Equal(2, ubuntu.GetProperty("packs").GetInt32());        // 24 units in packs of 12
        Assert.Equal(2 * 196.22m + ubuntu.GetProperty("deliveryCost").GetDecimal(), ubuntu.GetProperty("total").GetDecimal());
        Assert.True(ubuntu.GetProperty("orderedLastTime").GetBoolean());
        Assert.False(kasi.GetProperty("orderedLastTime").GetBoolean());
        Assert.True(ubuntu.GetProperty("inYourArea").GetBoolean());     // delivers to Khayelitsha
        Assert.False(kasi.GetProperty("inYourArea").GetBoolean());
    }

    [Fact]
    public async Task The_last_supplier_is_found_by_partial_product_name_and_is_empty_when_never_ordered()
    {
        var owner = await api.LoginAs(Owner);
        var milk = await owner.GetAsync("/api/orders/last-supplier?product=MILK");
        Assert.Equal(HttpStatusCode.OK, milk.StatusCode);
        Assert.Equal(3, (await Json(milk)).GetProperty("supplierId").GetInt32());

        Assert.Equal(HttpStatusCode.NoContent, (await owner.GetAsync("/api/orders/last-supplier?product=paraffin")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync("/api/orders/last-supplier?stockItemId=101")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync("/api/stock/101/suppliers")).StatusCode);
    }

    // ------------------------------------------------------------------ FR-05 resolved alerts

    [Fact]
    public async Task Resolved_alerts_are_listed_separately_from_open_ones()
    {
        var owner = await api.LoginAs(Owner);
        var resolved = await Json(await owner.GetAsync("/api/stock/alerts?status=resolved"));
        Assert.NotEmpty(resolved.EnumerateArray());   // the seed resolves every alert it raises
        Assert.All(resolved.EnumerateArray(), a => Assert.NotEqual(JsonValueKind.Null, a.GetProperty("resolvedAt").ValueKind));

        var open = await Json(await owner.GetAsync("/api/stock/alerts"));
        Assert.All(open.EnumerateArray(), a => Assert.Equal(JsonValueKind.Null, a.GetProperty("resolvedAt").ValueKind));
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync("/api/stock/alerts?status=closed")).StatusCode);
    }
}
