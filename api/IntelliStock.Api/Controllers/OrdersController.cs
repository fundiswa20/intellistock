using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using IntelliStock.Api.Data;
using IntelliStock.Api.Domain;
using IntelliStock.Api.Models;
using IntelliStock.Api.Services;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Controllers;

public record PlaceOrderRequest(
    int SupplierListingId,
    [Range(1, 1000)] int Packs,
    int? StockItemId,
    [StringLength(255)] string? Note);

public record ReceiveOrderRequest(int? StockItemId);

public record CancelOrderRequest([StringLength(255)] string? Reason);

// D42: a product the shop does not stock yet, created and ordered in one step
public record NewProductOrderRequest(
    [Required, StringLength(120, MinimumLength = 2)] string Name,
    [Required] string Category,
    [Required, StringLength(30)] string Unit,
    [Range(0, 100_000)] int ReorderLevel,
    [Range(0, 1_000_000)] decimal SellingPrice,
    int SupplierListingId,
    [Range(1, 1000)] int Packs,
    [StringLength(255)] string? Note);

// FR-06 (browse supplier listings) and FR-10 (place and track orders), for the owner (D37).
// Like stock, another owner's order answers 404 (D28).
[ApiController]
[Authorize(Roles = "BusinessOwner")]
public class OrdersController(InventoryRepository db, OrderNotifications notify) : ControllerBase
{
    private int OwnerId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // ------------------------------------------------------------------ FR-06 browse listings

    // every active listing from every supplier, cheapest per unit first within a product
    [HttpGet("api/listings")]
    public async Task<IActionResult> Listings([FromQuery] string? q)
    {
        var query = from l in db.SupplierListings
                    join s in db.Suppliers on l.SupplierId equals s.RegisteredUserId
                    where l.IsActive
                    select new { l, s };
        if (!string.IsNullOrWhiteSpace(q))
            query = query.Where(x => x.l.ProductName.Contains(q.Trim()) || x.s.CompanyName.Contains(q.Trim()));
        var rows = await query.ToListAsync();
        var location = await MyLocation();
        return Ok(rows
            .OrderBy(x => x.l.ProductName).ThenBy(x => x.l.PackPrice / x.l.PackSize)
            .Select(x => new
            {
                x.l.SupplierListingId, x.l.SupplierId, supplierName = x.s.CompanyName, x.s.DeliveryArea,
                x.s.ReliabilityScore, x.l.ProductName, x.l.Category, x.l.PackSize, x.l.PackPrice,
                unitPrice = Math.Round(x.l.PackPrice / x.l.PackSize, 2),
                x.l.LeadTimeDays, x.l.AvailableQuantity, x.l.DeliveryCost, x.l.UpdatedAt,
                inYourArea = ProductMatch.InArea(location, x.s.DeliveryArea),
                reach = ReachName(location, x.s.DeliveryArea),
            }));
    }

    // ------------------------------------------------------------------ D42 suppliers

    // registered suppliers the owner can plausibly be delivered to: their area first, then the
    // same province, then those whose area cannot be judged. Out-of-province suppliers are left out.
    [HttpGet("api/suppliers")]
    public async Task<IActionResult> Suppliers()
    {
        var location = await MyLocation();
        var suppliers = await db.Suppliers.ToListAsync();
        var listings = await db.SupplierListings.Where(l => l.IsActive).ToListAsync();
        return Ok(suppliers
            .Select(s => (s, reach: ProductMatch.ReachOf(location, s.DeliveryArea),
                          mine: listings.Where(l => l.SupplierId == s.RegisteredUserId).ToList()))
            .Where(x => x.reach != ProductMatch.Reach.OutOfReach)
            .OrderBy(x => x.reach).ThenByDescending(x => x.s.ReliabilityScore).ThenBy(x => x.s.CompanyName)
            .Select(x => new
            {
                supplierId = x.s.RegisteredUserId, companyName = x.s.CompanyName, x.s.DeliveryArea, x.s.Phone,
                x.s.ReliabilityScore, reach = ReachName(x.reach),
                activeListings = x.mine.Count,
                minLeadTimeDays = x.mine.Count == 0 ? (int?)null : x.mine.Min(l => l.LeadTimeDays),
                maxLeadTimeDays = x.mine.Count == 0 ? (int?)null : x.mine.Max(l => l.LeadTimeDays),
                products = x.mine.Select(l => l.ProductName).OrderBy(n => n).ToList(),
            }));
    }

    // one supplier and their active listings
    [HttpGet("api/suppliers/{id:int}")]
    public async Task<IActionResult> Supplier(int id)
    {
        var s = await db.Suppliers.SingleOrDefaultAsync(x => x.RegisteredUserId == id);
        if (s is null) return NotFound();
        var location = await MyLocation();
        var listings = await db.SupplierListings.Where(l => l.SupplierId == id && l.IsActive).ToListAsync();
        return Ok(new
        {
            supplierId = s.RegisteredUserId, companyName = s.CompanyName, s.DeliveryArea, s.Phone, s.ReliabilityScore,
            reach = ReachName(location, s.DeliveryArea),
            listings = listings.OrderBy(l => l.ProductName).Select(l => new
            {
                l.SupplierListingId, l.SupplierId, supplierName = s.CompanyName, s.DeliveryArea, s.ReliabilityScore,
                l.ProductName, l.Category, l.PackSize, l.PackPrice, unitPrice = Math.Round(l.PackPrice / l.PackSize, 2),
                l.LeadTimeDays, l.AvailableQuantity, l.DeliveryCost, l.UpdatedAt,
                inYourArea = ProductMatch.InArea(location, s.DeliveryArea),
                reach = ReachName(location, s.DeliveryArea),
            }),
        });
    }

    // D42 step 1 of adding a product: every listing matching what the owner typed, from suppliers
    // who can reach them, priced for the same number of units (the largest pack among them) so
    // the delivered totals compare, cheapest first
    [HttpGet("api/listings/search")]
    public async Task<IActionResult> Search([FromQuery] string? q, [FromQuery] int? units)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["q"] = ["Type at least two letters of the product."],
            }));
        var term = q.Trim();
        var location = await MyLocation();
        var rows = (await (from l in db.SupplierListings
                           join s in db.Suppliers on l.SupplierId equals s.RegisteredUserId
                           where l.IsActive
                           select new { l, s }).ToListAsync())
            .Where(x => ProductMatch.Matches(term, x.l.ProductName)
                        && ProductMatch.ReachOf(location, x.s.DeliveryArea) != ProductMatch.Reach.OutOfReach)
            .ToList();
        var want = Math.Max(1, units ?? (rows.Count == 0 ? 1 : rows.Max(x => x.l.PackSize)));
        var options = rows.Select(x =>
            {
                var packs = (int)Math.Ceiling(want / (double)x.l.PackSize);
                return new
                {
                    x.l.SupplierListingId, x.l.SupplierId, supplierName = x.s.CompanyName, x.s.DeliveryArea,
                    x.s.ReliabilityScore, x.l.ProductName, x.l.Category, x.l.PackSize, x.l.PackPrice,
                    unitPrice = Math.Round(x.l.PackPrice / x.l.PackSize, 2),
                    x.l.LeadTimeDays, x.l.AvailableQuantity, x.l.DeliveryCost, x.l.UpdatedAt,
                    packs, units = packs * x.l.PackSize, subtotal = packs * x.l.PackPrice,
                    total = OrderRules.Total(packs, x.l.PackPrice, x.l.DeliveryCost),
                    inYourArea = ProductMatch.InArea(location, x.s.DeliveryArea),
                    reach = ReachName(location, x.s.DeliveryArea),
                    canFulfil = x.l.AvailableQuantity >= packs,
                };
            })
            .OrderByDescending(o => o.canFulfil).ThenBy(o => o.total).ThenBy(o => o.LeadTimeDays)
            .ToList();
        return Ok(new { searchTerm = term, unitsWanted = want, options });
    }

    // D42 step 3: create the stock item (opening quantity 0, unit cost from the listing's price
    // per unit) and place the order for it, in one transaction. Stock arrives on receipt.
    [HttpPost("api/orders/new-product")]
    public async Task<IActionResult> NewProduct(NewProductOrderRequest req)
    {
        if (!StockRules.Categories.Contains(req.Category))
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["category"] = [$"Category must be one of: {string.Join(", ", StockRules.Categories)}."],
            }));

        await using var tx = await db.Database.BeginTransactionAsync();
        var listing = await LockListing(req.SupplierListingId);
        if (ListingError(listing, req.Packs) is { } error) return error;

        var now = Clock.Now;
        var item = new StockItem
        {
            BusinessOwnerId = OwnerId, Name = req.Name.Trim(), Category = req.Category, Unit = req.Unit.Trim(),
            ReorderLevel = req.ReorderLevel, UnitCost = Math.Round(listing!.PackPrice / listing.PackSize, 2),
            SellingPrice = req.SellingPrice, CreatedAt = now,
        };
        db.StockItems.Add(item);
        await db.SaveChangesAsync();
        await StockLedger.ApplyAlertRule(db, item, now);   // at 0 it starts low, as any item created empty does

        var (order, supplier) = await AddOrder(listing, req.Packs, item.StockItemId, req.Note);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        await notify.Placed(order, await db.BusinessOwners.SingleAsync(w => w.RegisteredUserId == OwnerId), supplier);
        return CreatedAtAction(nameof(Get), new { id = order.PurchaseOrderId }, new
        {
            item = new
            {
                item.StockItemId, item.Name, item.Category, item.Unit, item.QuantityOnHand, item.ReorderLevel,
                item.UnitCost, item.SellingPrice,
            },
            order = OrderViews.View(order, supplier, null),
        });
    }

    private static string ReachName(string? location, string? area) => ReachName(ProductMatch.ReachOf(location, area));

    private static string ReachName(ProductMatch.Reach r) => r switch
    {
        ProductMatch.Reach.InArea => "inArea",
        ProductMatch.Reach.Nearby => "nearby",
        ProductMatch.Reach.OutOfReach => "outOfReach",
        _ => "unknown",
    };

    // D39: the supplier of the owner's most recent order for a product - by stock item, or by a
    // product name matched like the comparison does. Declined and cancelled orders do not count.
    // 204 when the owner has never ordered it.
    [HttpGet("api/orders/last-supplier")]
    public async Task<IActionResult> LastSupplier([FromQuery] int? stockItemId, [FromQuery] string? product)
    {
        StockItem? item = null;
        if (stockItemId is { } id && (item = await MyItem(id).SingleOrDefaultAsync()) is null) return NotFound();
        var name = item?.Name ?? product?.Trim();
        if (item is null && string.IsNullOrEmpty(name))
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["product"] = ["Give a stockItemId or a product name."],
            }));
        var last = await LastOrderFor(item?.StockItemId, name!);
        return last is null ? NoContent() : Ok(LastView(last));
    }

    // D39: restocking one item - every active listing of that product, with what the
    // recommended quantity would cost delivered, ranked cheapest first
    [HttpGet("api/stock/{id:int}/suppliers")]
    public async Task<IActionResult> Compare(int id, [FromQuery] int? units)
    {
        var item = await MyItem(id).SingleOrDefaultAsync();
        if (item is null) return NotFound();
        var want = Math.Max(1, units ?? Math.Max(item.ReorderLevel, 1));
        var location = await MyLocation();
        var last = await LastOrderFor(item.StockItemId, item.Name);

        var rows = await (from l in db.SupplierListings
                          join s in db.Suppliers on l.SupplierId equals s.RegisteredUserId
                          where l.IsActive
                          select new { l, s }).ToListAsync();
        var options = rows
            .Where(x => ProductMatch.Matches(item.Name, x.l.ProductName))
            .Select(x =>
            {
                var packs = (int)Math.Ceiling(want / (double)x.l.PackSize);
                return new
                {
                    x.l.SupplierListingId, x.l.SupplierId, supplierName = x.s.CompanyName, x.s.DeliveryArea,
                    x.s.ReliabilityScore, x.l.ProductName, x.l.Category, x.l.PackSize, x.l.PackPrice,
                    unitPrice = Math.Round(x.l.PackPrice / x.l.PackSize, 2),
                    x.l.LeadTimeDays, x.l.AvailableQuantity, x.l.DeliveryCost, x.l.UpdatedAt,
                    packs, units = packs * x.l.PackSize,
                    subtotal = packs * x.l.PackPrice,
                    total = OrderRules.Total(packs, x.l.PackPrice, x.l.DeliveryCost),
                    inYourArea = ProductMatch.InArea(location, x.s.DeliveryArea),
                    sameProduct = x.l.ProductName.Contains(item.Name, StringComparison.OrdinalIgnoreCase),
                    orderedLastTime = last?.o.SupplierId == x.l.SupplierId,
                    canFulfil = x.l.AvailableQuantity >= packs,
                };
            })
            // the ones that can supply it all, then the exact product before similar ones, then cheapest delivered
            .OrderByDescending(o => o.canFulfil).ThenByDescending(o => o.sameProduct)
            .ThenBy(o => o.total).ThenBy(o => o.LeadTimeDays)
            .ToList();

        return Ok(new
        {
            stockItemId = item.StockItemId, itemName = item.Name, searchTerm = ProductMatch.KeyTerm(item.Name),
            unitsWanted = want,
            lastSupplier = last is null ? null : LastView(last),
            options,
        });
    }

    private async Task<string?> MyLocation() =>
        await db.BusinessOwners.Where(o => o.RegisteredUserId == OwnerId).Select(o => o.Location).SingleOrDefaultAsync();

    private async Task<LastOrder?> LastOrderFor(int? stockItemId, string productName)
    {
        var orders = await (from o in db.PurchaseOrders
                            join s in db.Suppliers on o.SupplierId equals s.RegisteredUserId
                            where o.BusinessOwnerId == OwnerId && o.Status != "Declined" && o.Status != "Cancelled"
                            orderby o.CreatedAt descending, o.PurchaseOrderId descending
                            select new LastOrder(o, s)).ToListAsync();
        return orders.FirstOrDefault(x =>
            (stockItemId != null && x.o.StockItemId == stockItemId) || ProductMatch.Matches(productName, x.o.ProductName));
    }

    private static object LastView(LastOrder x) => new
    {
        supplierId = x.s.RegisteredUserId, supplierName = x.s.CompanyName,
        x.o.PurchaseOrderId, x.o.ProductName, x.o.Packs, x.o.Status, x.o.CreatedAt,
        total = OrderRules.Total(x.o.Packs, x.o.PackPrice, x.o.DeliveryCost),
    };

    private record LastOrder(PurchaseOrder o, Supplier s);

    // ------------------------------------------------------------------ FR-10 orders

    [HttpGet("api/orders")]
    public async Task<IActionResult> List() =>
        Ok((await MyOrders().ToListAsync())
            .OrderByDescending(x => x.o.CreatedAt).ThenByDescending(x => x.o.PurchaseOrderId)
            .Select(x => OrderViews.View(x.o, x.s, null)));

    [HttpGet("api/orders/{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var x = await MyOrders(id).SingleOrDefaultAsync();
        return x is null ? NotFound() : Ok(OrderViews.View(x.o, x.s, null));
    }

    [HttpPost("api/orders")]
    public async Task<IActionResult> Place(PlaceOrderRequest req)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        var listing = await LockListing(req.SupplierListingId);
        if (ListingError(listing, req.Packs) is { } error) return error;
        if (req.StockItemId is { } itemId && !await MyItem(itemId).AnyAsync())
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["stockItemId"] = ["That stock item does not exist."],
            }));

        var (order, supplier) = await AddOrder(listing!, req.Packs, req.StockItemId, req.Note);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        var owner = await db.BusinessOwners.SingleAsync(w => w.RegisteredUserId == OwnerId);
        await notify.Placed(order, owner, supplier);
        return CreatedAtAction(nameof(Get), new { id = order.PurchaseOrderId }, OrderViews.View(order, supplier, null));
    }

    // lock the listing so two orders cannot both take the last packs
    private Task<SupplierListing?> LockListing(int id) =>
        db.SupplierListings.FromSqlInterpolated($"SELECT * FROM SupplierListing WHERE SupplierListingId = {id} FOR UPDATE")
            .SingleOrDefaultAsync();

    private IActionResult? ListingError(SupplierListing? listing, int packs)
    {
        if (listing is null || !listing.IsActive)
            return NotFound(new ProblemDetails { Title = "That listing is no longer available.", Status = 404 });
        if (packs > listing.AvailableQuantity)
            return Conflict(new ProblemDetails
            {
                Title = listing.AvailableQuantity == 0
                    ? "The supplier has none of this in stock right now."
                    : $"The supplier has only {listing.AvailableQuantity} {(listing.AvailableQuantity == 1 ? "pack" : "packs")} available.",
                Status = 409,
            });
        return null;
    }

    // takes the packs off the listing and adds the order; the caller saves and commits
    private async Task<(PurchaseOrder, Supplier)> AddOrder(SupplierListing listing, int packs, int? stockItemId, string? note)
    {
        var supplier = await db.Suppliers.SingleAsync(s => s.RegisteredUserId == listing.SupplierId);
        listing.AvailableQuantity -= packs;
        var order = new PurchaseOrder
        {
            BusinessOwnerId = OwnerId,
            SupplierId = listing.SupplierId,
            SupplierListingId = listing.SupplierListingId,
            StockItemId = stockItemId,
            ProductName = listing.ProductName,
            PackSize = listing.PackSize,
            PackPrice = listing.PackPrice,
            Packs = packs,
            DeliveryCost = listing.DeliveryCost,
            Status = "Placed",
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
            CreatedAt = Clock.Now,
        };
        db.PurchaseOrders.Add(order);
        return (order, supplier);
    }

    [HttpPost("api/orders/{id:int}/cancel")]
    public async Task<IActionResult> Cancel(int id,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CancelOrderRequest? req)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        var order = await OrderViews.Lock(db, id);
        if (order is null || order.BusinessOwnerId != OwnerId) return NotFound();
        if (!OrderRules.OwnerCanCancel(order.Status))
            return Conflict(new ProblemDetails
            {
                Title = $"This order is {order.Status.ToLower()}; only an order the supplier has not confirmed can be cancelled.",
                Status = 409,
            });

        order.Status = "Cancelled";
        order.ClosedAt = Clock.Now;
        await OrderViews.ReturnPacks(db, order);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        var supplier = await db.Suppliers.SingleAsync(s => s.RegisteredUserId == order.SupplierId);
        var owner = await db.BusinessOwners.SingleAsync(w => w.RegisteredUserId == OwnerId);
        await notify.StatusChanged(order, owner, supplier, string.IsNullOrWhiteSpace(req?.Reason) ? null : req.Reason.Trim());
        return Ok(OrderViews.View(order, supplier, null));
    }

    // books a delivered order into stock as one Restock movement (FR-04), once
    [HttpPost("api/orders/{id:int}/receive")]
    public async Task<IActionResult> Receive(int id, ReceiveOrderRequest? req)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        var order = await OrderViews.Lock(db, id);
        if (order is null || order.BusinessOwnerId != OwnerId) return NotFound();
        if (order.Status != "Delivered")
            return Conflict(new ProblemDetails { Title = "Only a delivered order can be received into stock.", Status = 409 });
        if (order.ReceivedAt is not null)
            return Conflict(new ProblemDetails { Title = "This order has already been received into stock.", Status = 409 });

        var itemId = req?.StockItemId ?? order.StockItemId;
        if (itemId is null)
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["stockItemId"] = ["Choose which stock item this delivery is for."],
            }));
        var item = await StockLedger.LockItem(db, itemId.Value);
        if (item is null || item.BusinessOwnerId != OwnerId || !item.IsActive)
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["stockItemId"] = ["That stock item does not exist."],
            }));

        var supplier = await db.Suppliers.SingleAsync(s => s.RegisteredUserId == order.SupplierId);
        var now = Clock.Now;
        var (_, alert) = await StockLedger.ApplyMovement(db, item, "Restock", order.Packs * order.PackSize,
            $"Order #{order.PurchaseOrderId} from {supplier.CompanyName}", now, OwnerId);
        order.StockItemId = item.StockItemId;
        order.ReceivedAt = now;
        await db.SaveChangesAsync();
        await tx.CommitAsync();

        return Ok(new
        {
            order = OrderViews.View(order, supplier, null),
            quantityOnHand = item.QuantityOnHand,
            alert = alert == StockRules.AlertAction.Resolve ? "resolved" : null,
        });
    }

    private IQueryable<StockItem> MyItem(int id) =>
        db.StockItems.Where(s => s.StockItemId == id && s.BusinessOwnerId == OwnerId && s.IsActive);

    // filter before projecting: EF cannot translate a filter on the projected record
    private IQueryable<OrderRow> MyOrders(int? id = null) =>
        from o in db.PurchaseOrders
        join s in db.Suppliers on o.SupplierId equals s.RegisteredUserId
        where o.BusinessOwnerId == OwnerId && (id == null || o.PurchaseOrderId == id)
        select new OrderRow(o, s);

    private record OrderRow(PurchaseOrder o, Supplier s);
}

// the one shape an order is shown in, to the owner and to the supplier
public static class OrderViews
{
    public static object View(PurchaseOrder o, Supplier s, BusinessOwner? owner) => new
    {
        o.PurchaseOrderId, o.Status, o.ProductName, o.PackSize, o.PackPrice, o.Packs,
        units = o.Packs * o.PackSize,
        subtotal = o.Packs * o.PackPrice,
        o.DeliveryCost,
        total = OrderRules.Total(o.Packs, o.PackPrice, o.DeliveryCost),
        o.Note, o.StockItemId, o.SupplierListingId,
        supplier = new { id = s.RegisteredUserId, name = s.CompanyName, s.Phone, s.DeliveryArea, s.ReliabilityScore },
        owner = owner is null ? null : new
        {
            id = owner.RegisteredUserId, name = owner.BusinessName, contact = owner.FullName, owner.Location, owner.Phone,
        },
        o.CreatedAt, o.ConfirmedAt, o.DispatchedAt, o.DeliveredAt, o.ClosedAt, o.ReceivedAt,
        nextStatuses = OrderRules.SupplierNext(o.Status),
        canCancel = OrderRules.OwnerCanCancel(o.Status),
        canReceive = o.Status == "Delivered" && o.ReceivedAt is null,
    };

    // lock the order row: a supplier's status change and an owner's cancel cannot interleave
    public static Task<PurchaseOrder?> Lock(InventoryRepository db, int id) =>
        db.PurchaseOrders.FromSqlInterpolated($"SELECT * FROM PurchaseOrder WHERE PurchaseOrderId = {id} FOR UPDATE")
            .SingleOrDefaultAsync();

    public static async Task ReturnPacks(InventoryRepository db, PurchaseOrder order)
    {
        var listing = await db.SupplierListings
            .FromSqlInterpolated($"SELECT * FROM SupplierListing WHERE SupplierListingId = {order.SupplierListingId} FOR UPDATE")
            .SingleAsync();
        listing.AvailableQuantity += order.Packs;
    }
}
