using IntelliStock.Api.Domain;
using IntelliStock.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Data;

// FR-04 + FR-05: append one movement to the log and apply the alert rule. Shared by
// StockController (movements the owner records) and OrdersController (a delivery booked
// into stock). The caller locks the item row, owns the database transaction and saves.
public static class StockLedger
{
    public static async Task<(Transaction, StockRules.AlertAction)> ApplyMovement(
        InventoryRepository db, StockItem item, string type, int change, string? note, DateTime when, int userId)
    {
        item.QuantityOnHand += change;
        var t = new Transaction
        {
            StockItemId = item.StockItemId,
            Type = type,
            QuantityChange = change,
            QuantityAfter = item.QuantityOnHand,
            OccurredAt = when,
            RecordedByUserId = userId,
            Note = string.IsNullOrEmpty(note) ? null : note,
        };
        db.Transactions.Add(t);
        return (t, await ApplyAlertRule(db, item, when));
    }

    public static async Task<StockRules.AlertAction> ApplyAlertRule(InventoryRepository db, StockItem item, DateTime when)
    {
        var open = await db.Alerts.SingleOrDefaultAsync(a => a.StockItemId == item.StockItemId && a.ResolvedAt == null);
        var action = StockRules.AlertDecision(item.QuantityOnHand, item.ReorderLevel, open is not null);
        if (action == StockRules.AlertAction.Raise)
            db.Alerts.Add(new Alert
            {
                StockItemId = item.StockItemId,
                Message = StockRules.AlertMessage(item.Name, item.Unit, item.QuantityOnHand, item.ReorderLevel),
                QuantityAtAlert = item.QuantityOnHand,
                ReorderLevel = item.ReorderLevel,
                CreatedAt = when,
            });
        else if (action == StockRules.AlertAction.Resolve)
            open!.ResolvedAt = when;
        return action;
    }

    // row lock, so two movements recorded at once cannot both read the same balance
    public static Task<StockItem?> LockItem(InventoryRepository db, int id) =>
        db.StockItems.FromSqlInterpolated($"SELECT * FROM StockItem WHERE StockItemId = {id} FOR UPDATE")
            .SingleOrDefaultAsync();
}
