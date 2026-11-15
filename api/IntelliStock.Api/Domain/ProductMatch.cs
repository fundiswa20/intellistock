using System.Text.RegularExpressions;

namespace IntelliStock.Api.Domain;

// D39: which supplier listings are "the same product" as an owner's stock item, and whether a
// supplier delivers to the owner. Pure functions so they can be unit tested.
public static partial class ProductMatch
{
    // The product word of a name: the last word before the first size or count.
    //   "Clover Long Life Milk 1L"  -> "milk"
    //   "Albany Brown Bread 700g"   -> "bread"
    //   "Joko Tea 100 bags"         -> "tea"
    //   "Large Eggs 6-pack"         -> "eggs"
    public static string KeyTerm(string name)
    {
        var words = Words().Matches(name).Select(m => m.Value).ToList();
        var before = words.TakeWhile(w => !w.Any(char.IsDigit)).ToList();
        var pick = before.LastOrDefault() ?? words.FirstOrDefault(w => !w.Any(char.IsDigit)) ?? name.Trim();
        return pick.ToLowerInvariant();
    }

    // case-insensitive: the listing contains the whole item name, or a word that starts with
    // the item's product word (singular, so "eggs" also finds "Egg tray")
    public static bool Matches(string itemName, string listingName)
    {
        if (listingName.Contains(itemName.Trim(), StringComparison.OrdinalIgnoreCase)) return true;
        var term = Stem(KeyTerm(itemName));
        if (term.Length < 3) return false;
        return Words().Matches(listingName).Any(m => m.Value.StartsWith(term, StringComparison.OrdinalIgnoreCase));
    }

    // a supplier's delivery area is a comma-separated list of places; the owner is in the area
    // when their location names any of them ("Section 3, Khayelitsha, Cape Town" / "Khayelitsha, Philippi")
    public static bool InArea(string? ownerLocation, string? deliveryArea)
    {
        if (string.IsNullOrWhiteSpace(ownerLocation) || string.IsNullOrWhiteSpace(deliveryArea)) return false;
        return deliveryArea.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(place => place.Length >= 3 && ownerLocation.Contains(place, StringComparison.OrdinalIgnoreCase));
    }

    private static string Stem(string w) => w.Length > 3 && w.EndsWith('s') ? w[..^1] : w;

    [GeneratedRegex(@"[\p{L}\p{N}'’-]+")]
    private static partial Regex Words();
}
