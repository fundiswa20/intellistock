namespace IntelliStock.Api.Domain;

// The stock movement and alert rules, as pure functions so they can be unit tested
// without a database. The controller applies them; the database enforces the same
// limits again with CHECK constraints (D19).
public static class StockRules
{
    public static readonly string[] MovementTypes = ["Sale", "Restock", "Adjustment"];

    // The model only knows these categories (BUILD-JOURNAL O2); anything else would be
    // coded -1 by the model service
    public static readonly string[] Categories = ["Clothing", "Electronics", "Furniture", "Groceries", "Toys"];

    public enum AlertAction { None, Raise, Resolve }

    // FR-04: turn a requested movement into a signed quantity change, or explain why not.
    // Sale and Restock take a positive quantity; Adjustment takes a signed correction.
    public static (int Change, string? Error) SignedChange(string type, int quantity, int onHand)
    {
        switch (type)
        {
            case "Sale":
                if (quantity <= 0) return (0, "A sale quantity must be greater than 0.");
                if (quantity > onHand) return (0, $"Cannot sell {quantity} - only {onHand} in stock.");
                return (-quantity, null);
            case "Restock":
                if (quantity <= 0) return (0, "A restock quantity must be greater than 0.");
                return (quantity, null);
            case "Adjustment":
                if (quantity == 0) return (0, "An adjustment cannot be 0.");
                if (onHand + quantity < 0) return (0, $"An adjustment of {quantity} would take stock below 0 (on hand {onHand}).");
                return (quantity, null);
            default:
                return (0, $"Unknown movement type '{type}'. Use Sale, Restock or Adjustment.");
        }
    }

    // FR-05: raise at or below the reorder level, resolve once back above it,
    // at most one open alert per item (D21)
    public static AlertAction AlertDecision(int onHand, int reorderLevel, bool hasOpenAlert)
    {
        if (onHand <= reorderLevel && !hasOpenAlert) return AlertAction.Raise;
        if (onHand > reorderLevel && hasOpenAlert) return AlertAction.Resolve;
        return AlertAction.None;
    }

    public static string AlertMessage(string name, string unit, int onHand, int reorderLevel) =>
        $"{name} is down to {onHand} {Plural(unit, onHand)} (reorder level {reorderLevel})";

    public static string Plural(string unit, int n) => n == 1 ? unit : unit switch
    {
        "loaf" => "loaves",
        "box" => "boxes",
        "each" => "each",
        _ => unit + "s",
    };
}
