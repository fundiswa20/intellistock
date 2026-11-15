namespace IntelliStock.Api.Domain;

// FR-10: order status rules, as pure functions so they can be unit tested (D37).
//   Placed -> Confirmed -> Dispatched -> Delivered      (the supplier moves it forward)
//   Placed -> Declined                                  (the supplier)
//   Placed -> Cancelled                                 (the owner)
public static class OrderRules
{
    public static string[] SupplierNext(string status) => status switch
    {
        "Placed" => ["Confirmed", "Declined"],
        "Confirmed" => ["Dispatched"],
        "Dispatched" => ["Delivered"],
        _ => [],
    };

    public static string? SupplierMoveError(string from, string to)
    {
        var next = SupplierNext(from);
        if (next.Contains(to)) return null;
        if (next.Length == 0) return $"This order is {from.ToLower()} and can no longer change.";
        return $"An order that is {from.ToLower()} can only be marked "
               + string.Join(" or ", next.Select(s => s.ToLower())) + ".";
    }

    public static bool OwnerCanCancel(string status) => status == "Placed";

    // a declined or cancelled order gives its packs back to the listing
    public static bool ReturnsStock(string to) => to is "Declined" or "Cancelled";

    public static bool IsOpen(string status) => status is "Placed" or "Confirmed" or "Dispatched";

    public static decimal Total(int packs, decimal packPrice, decimal deliveryCost) => packs * packPrice + deliveryCost;
}
