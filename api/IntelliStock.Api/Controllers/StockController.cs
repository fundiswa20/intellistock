using System.ComponentModel.DataAnnotations;
using System.Net;
using System.Security.Claims;
using System.Text.Json;
using IntelliStock.Api.Data;
using IntelliStock.Api.Domain;
using IntelliStock.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Controllers;

public record StockItemRequest(
    [Required, StringLength(120, MinimumLength = 2)] string Name,
    [Required] string Category,
    [Required, StringLength(30)] string Unit,
    [Range(0, 100_000)] int ReorderLevel,
    [Range(0, 1_000_000)] decimal UnitCost,
    [Range(0, 1_000_000)] decimal SellingPrice,
    [Range(0, 100_000)] int OpeningQuantity = 0);

public record MovementRequest(
    [Required] string Type,
    int Quantity,
    [StringLength(255)] string? Note);

// UML: StockController. Calls EF Core (InventoryRepository) directly - no service or
// repository layer in between (D15). Every query is scoped to the signed-in owner; another
// owner's item answers 404, so the API does not reveal that it exists.
[ApiController]
[Route("api/stock")]
[Authorize(Roles = "BusinessOwner")]
public class StockController(InventoryRepository db, IHttpClientFactory http, ILogger<StockController> log)
    : ControllerBase
{
    public const string ModelClient = "ReorderPredictionService";

    private int OwnerId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private IQueryable<StockItem> MyItems => db.StockItems.Where(s => s.BusinessOwnerId == OwnerId && s.IsActive);

    // ------------------------------------------------------------------ FR-03 stock item CRUD

    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await MyItems.OrderBy(s => s.Name).Select(s => ItemView(s)).ToListAsync());

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var item = await MyItems.SingleOrDefaultAsync(s => s.StockItemId == id);
        return item is null ? NotFound() : Ok(ItemView(item));
    }

    [HttpPost]
    public async Task<IActionResult> Create(StockItemRequest req)
    {
        if (CategoryError(req.Category) is { } error) return error;

        var now = Clock.Now;
        var item = new StockItem
        {
            BusinessOwnerId = OwnerId,
            Name = req.Name.Trim(),
            Category = req.Category,
            Unit = req.Unit.Trim(),
            ReorderLevel = req.ReorderLevel,
            UnitCost = req.UnitCost,
            SellingPrice = req.SellingPrice,
            CreatedAt = now,
        };

        await using var tx = await db.Database.BeginTransactionAsync();
        db.StockItems.Add(item);
        await db.SaveChangesAsync();
        // FR-04: opening stock goes through the transaction log like any other movement,
        // so QuantityOnHand always equals the sum of the log
        if (req.OpeningQuantity > 0)
            await StockLedger.ApplyMovement(db, item, "Adjustment", req.OpeningQuantity, "Opening stock count", now, OwnerId);
        else
            await StockLedger.ApplyAlertRule(db, item, now);   // an item created with 0 stock is already low
        await db.SaveChangesAsync();
        await tx.CommitAsync();

        return CreatedAtAction(nameof(Get), new { id = item.StockItemId }, ItemView(item));
    }

    // Quantity is deliberately not editable here - it changes only through movements (FR-04)
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, StockItemRequest req)
    {
        if (CategoryError(req.Category) is { } error) return error;
        var item = await MyItems.SingleOrDefaultAsync(s => s.StockItemId == id);
        if (item is null) return NotFound();

        item.Name = req.Name.Trim();
        item.Category = req.Category;
        item.Unit = req.Unit.Trim();
        item.ReorderLevel = req.ReorderLevel;
        item.UnitCost = req.UnitCost;
        item.SellingPrice = req.SellingPrice;
        await StockLedger.ApplyAlertRule(db, item, Clock.Now);   // a new reorder level can raise or clear an alert
        await db.SaveChangesAsync();
        return Ok(ItemView(item));
    }

    // FR-03: soft delete (D20). The item's transactions stay, because FR-04 makes them
    // permanent; its open alert is closed so the alert list only shows live stock.
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var item = await MyItems.SingleOrDefaultAsync(s => s.StockItemId == id);
        if (item is null) return NotFound();
        item.IsActive = false;
        var open = await db.Alerts.SingleOrDefaultAsync(a => a.StockItemId == id && a.ResolvedAt == null);
        if (open is not null) open.ResolvedAt = Clock.Now;
        await db.SaveChangesAsync();
        return NoContent();
    }

    // ------------------------------------------------------------------ FR-04 stock movements

    [HttpPost("{id:int}/movements")]
    public async Task<IActionResult> RecordMovement(int id, MovementRequest req)
    {
        await using var tx = await db.Database.BeginTransactionAsync();

        // lock the row so two movements recorded at once cannot both read the same balance
        var item = await StockLedger.LockItem(db, id);
        if (item is null || item.BusinessOwnerId != OwnerId || !item.IsActive) return NotFound();

        var (change, error) = StockRules.SignedChange(req.Type, req.Quantity, item.QuantityOnHand);
        if (error is not null)
            return req.Type == "Sale" && req.Quantity > item.QuantityOnHand
                ? Conflict(new ProblemDetails { Title = error, Status = 409 })
                : ValidationProblem(new ValidationProblemDetails(
                    new Dictionary<string, string[]> { ["quantity"] = [error] }));

        var (transaction, alertAction) = await StockLedger.ApplyMovement(db, item, req.Type, change, req.Note?.Trim(), Clock.Now, OwnerId);
        await db.SaveChangesAsync();
        await tx.CommitAsync();

        return Ok(new
        {
            transaction = TransactionView(transaction),
            item = ItemView(item),
            alert = alertAction switch
            {
                StockRules.AlertAction.Raise => "raised",
                StockRules.AlertAction.Resolve => "resolved",
                _ => null,
            },
        });
    }

    // the log is read-only: there is no endpoint to edit or delete a movement (FR-04)
    [HttpGet("{id:int}/movements")]
    public async Task<IActionResult> Movements(int id, [FromQuery] int limit = 50)
    {
        if (!await MyItems.AnyAsync(s => s.StockItemId == id)) return NotFound();
        var rows = await db.Transactions.Where(t => t.StockItemId == id)
            .OrderByDescending(t => t.OccurredAt).ThenByDescending(t => t.TransactionId)
            .Take(Math.Clamp(limit, 1, 500))
            .ToListAsync();
        return Ok(rows.Select(TransactionView));
    }

    // ------------------------------------------------------------------ FR-05 low-stock alerts

    // ?status=open (the default, as before), resolved or all. Resolved: the latest 100.
    [HttpGet("alerts")]
    public async Task<IActionResult> Alerts([FromQuery] string status = "open")
    {
        if (status is not ("open" or "resolved" or "all"))
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["status"] = ["Status must be open, resolved or all."],
            }));
        var query = from a in db.Alerts
                    join s in MyItems on a.StockItemId equals s.StockItemId
                    select new { a, s };
        if (status == "open") query = query.Where(x => x.a.ResolvedAt == null);
        if (status == "resolved") query = query.Where(x => x.a.ResolvedAt != null);
        var rows = await query
            .OrderBy(x => x.a.ResolvedAt == null ? 0 : 1)
            .ThenByDescending(x => x.a.ResolvedAt ?? x.a.CreatedAt)
            .Take(status == "open" ? 1000 : 100)
            .Select(x => new
            {
                x.a.AlertId, x.a.StockItemId, stockItemName = x.s.Name, x.s.Unit, x.a.Message,
                x.a.QuantityAtAlert, x.a.ReorderLevel, currentQuantity = x.s.QuantityOnHand,
                x.a.CreatedAt, x.a.ResolvedAt,
            }).ToListAsync();
        return Ok(rows);
    }

    // ------------------------------------------------------------------ FR-08 reorder prediction

    [HttpPost("{id:int}/prediction")]
    public async Task<IActionResult> Predict(int id)
    {
        var item = await MyItems.SingleOrDefaultAsync(s => s.StockItemId == id);
        if (item is null) return NotFound();

        var today = Clock.Today;
        var lastDay = today.AddDays(-1);
        // the day an item is created is a partial day, so history starts the day after
        var created = DateOnly.FromDateTime(item.CreatedAt);
        var firstDay = created.AddDays(1);
        if (firstDay < lastDay.AddDays(1 - ReorderCalculator.HistoryDays))
            firstDay = lastDay.AddDays(1 - ReorderCalculator.HistoryDays);

        var from = firstDay.ToDateTime(TimeOnly.MinValue);
        var to = today.ToDateTime(TimeOnly.MinValue);
        var soldByDay = (await db.Transactions
                .Where(t => t.StockItemId == id && t.Type == "Sale" && t.OccurredAt >= from && t.OccurredAt < to)
                .GroupBy(t => t.OccurredAt.Date)
                .Select(g => new { Day = g.Key, Sold = -g.Sum(t => t.QuantityChange) })
                .ToListAsync())
            .ToDictionary(r => DateOnly.FromDateTime(r.Day), r => r.Sold);
        var series = ReorderCalculator.DailySeries(soldByDay, firstDay, lastDay);

        var lastRestock = await db.Transactions
            .Where(t => t.StockItemId == id && t.Type == "Restock")
            .MaxAsync(t => (DateTime?)t.OccurredAt);
        var daysSinceRestock = ReorderCalculator.DaysSinceRestock(
            lastRestock is null ? null : DateOnly.FromDateTime(lastRestock.Value), created, today);

        var model = await CallModel(item, series, daysSinceRestock, today);

        // ETR-03: the model's answer is used only when it had enough history and is
        // confident; otherwise the 30-day average is used and the reason is recorded
        var usedFallback = model.FallbackReason is not null;
        var demand = usedFallback ? ReorderCalculator.FallbackDemand(series) : model.Demand!.Value;

        var prediction = new ReorderPrediction
        {
            StockItemId = id,
            PredictedDailyDemand = Math.Round((decimal)demand, 3),
            Confidence = model.Confidence is null ? null : Math.Round((decimal)model.Confidence.Value, 3),
            DaysUntilStockOut = ReorderCalculator.DaysUntilStockOut(item.QuantityOnHand, demand),
            RecommendedQuantity = ReorderCalculator.RecommendedQuantity(demand, item.QuantityOnHand, item.ReorderLevel),
            ModelVersion = model.ModelVersion,
            UsedFallback = usedFallback,
            FallbackReason = model.FallbackReason,
            CreatedAt = Clock.Now,
        };
        db.ReorderPredictions.Add(prediction);
        await db.SaveChangesAsync();

        return Ok(PredictionView(prediction, item, series.Length));
    }

    [HttpGet("{id:int}/prediction")]
    public async Task<IActionResult> LatestPrediction(int id)
    {
        var item = await MyItems.SingleOrDefaultAsync(s => s.StockItemId == id);
        if (item is null) return NotFound();
        var p = await db.ReorderPredictions.Where(r => r.StockItemId == id)
            .OrderByDescending(r => r.CreatedAt).ThenByDescending(r => r.ReorderPredictionId)
            .FirstOrDefaultAsync();
        return p is null ? NotFound() : Ok(PredictionView(p, item, null));
    }

    // ------------------------------------------------------------------ helpers

    private record ModelResult(double? Demand, double? Confidence, string? ModelVersion, string? FallbackReason);

    // Calls ReorderPredictionService POST /predict (sequence diagram). Any failure to get a
    // usable answer becomes a fallback reason rather than an error for the owner.
    private async Task<ModelResult> CallModel(StockItem item, double[] series, int daysSinceRestock, DateOnly asOf)
    {
        try
        {
            var response = await http.CreateClient(ModelClient).PostAsJsonAsync("/predict", new
            {
                stockItemId = item.StockItemId,
                category = item.Category,
                dailySales = series,
                daysSinceRestock,
                asOfDate = asOf.ToString("yyyy-MM-dd"),
            });
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();

            // ETR-03: the model service answers 422 {"error": "insufficientHistory"} under 30 days
            if (response.StatusCode == HttpStatusCode.UnprocessableEntity
                && body.TryGetProperty("error", out var err) && err.GetString() == "insufficientHistory")
                return new ModelResult(null, null, null, "insufficientHistory");
            if (!response.IsSuccessStatusCode)
            {
                log.LogWarning("Model service returned {Status} for item {Id}", (int)response.StatusCode, item.StockItemId);
                return new ModelResult(null, null, null, "modelUnavailable");
            }

            var demand = body.GetProperty("predictedDailyDemand").GetDouble();
            var confidence = body.GetProperty("confidence").GetDouble();
            var version = body.GetProperty("modelVersion").GetString();
            // ETR-03: the model flags low confidence; the threshold fallback is applied here
            var low = body.GetProperty("lowConfidence").GetBoolean();
            return new ModelResult(demand, confidence, version, low ? "lowConfidence" : null);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException
                                       or KeyNotFoundException or InvalidOperationException)
        {
            log.LogWarning(ex, "Model service unavailable for item {Id}", item.StockItemId);
            return new ModelResult(null, null, null, "modelUnavailable");
        }
    }

    private IActionResult? CategoryError(string category) =>
        StockRules.Categories.Contains(category)
            ? null
            : ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["category"] = [$"Category must be one of: {string.Join(", ", StockRules.Categories)}."],
            }));

    private static object ItemView(StockItem s) => new
    {
        s.StockItemId, s.Name, s.Category, s.Unit, s.QuantityOnHand, s.ReorderLevel,
        s.UnitCost, s.SellingPrice, isLow = s.QuantityOnHand <= s.ReorderLevel, s.CreatedAt,
    };

    private static object TransactionView(Transaction t) => new
    {
        t.TransactionId, t.Type, t.QuantityChange, t.QuantityAfter, t.OccurredAt, t.Note,
    };

    private static object PredictionView(ReorderPrediction p, StockItem item, int? historyDays) => new
    {
        p.ReorderPredictionId, p.StockItemId, stockItemName = item.Name,
        quantityOnHand = item.QuantityOnHand, reorderLevel = item.ReorderLevel,
        p.PredictedDailyDemand, p.Confidence, p.DaysUntilStockOut, p.RecommendedQuantity,
        reorderByDate = ReorderCalculator.ReorderByDate(DateOnly.FromDateTime(p.CreatedAt),
            item.QuantityOnHand, item.ReorderLevel, (double)p.PredictedDailyDemand),
        // ETR-03: which path produced this recommendation, in the requirement's own words
        recommendationSource = ReorderCalculator.Source(p.FallbackReason),
        basis = ReorderCalculator.Basis(p.FallbackReason, p.ModelVersion, p.Confidence, historyDays),
        p.ModelVersion, p.UsedFallback, p.FallbackReason, historyDays, p.CreatedAt,
    };
}
