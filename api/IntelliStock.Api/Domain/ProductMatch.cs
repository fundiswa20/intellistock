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

    // D42: how reachable a supplier is from the owner.
    //   InArea     - the owner's location names one of the supplier's delivery places
    //   Nearby     - no place matches, but both are in the same province
    //   OutOfReach - the supplier only serves other provinces (a Cape Town supplier for a Durban shop)
    //   Unknown    - either side names no place this list knows, so it cannot be judged
    public enum Reach { InArea, Nearby, Unknown, OutOfReach }

    public static Reach ReachOf(string? ownerLocation, string? deliveryArea)
    {
        if (InArea(ownerLocation, deliveryArea)) return Reach.InArea;
        var owner = Provinces(ownerLocation);
        var supplier = Provinces(deliveryArea);
        if (owner.Count == 0 || supplier.Count == 0) return Reach.Unknown;
        return owner.Overlaps(supplier) ? Reach.Nearby : Reach.OutOfReach;
    }

    public static HashSet<string> Provinces(string? text)
    {
        var found = new HashSet<string>();
        if (string.IsNullOrWhiteSpace(text)) return found;
        foreach (var (place, province) in Places)
            if (Regex.IsMatch(text, $@"(?<![\p{{L}}]){Regex.Escape(place)}(?![\p{{L}}])", RegexOptions.IgnoreCase))
                found.Add(province);
        return found;
    }

    // townships, suburbs, metros and the provinces themselves, enough for the areas the
    // pilot shops and suppliers name; a place not listed makes the reach Unknown, not excluded
    private static readonly (string Place, string Province)[] Places =
    [
        .. Each("Western Cape", "Western Cape", "Cape Town", "Khayelitsha", "Mitchells Plain", "Philippi", "Cape Flats",
                "Gugulethu", "Nyanga", "Langa", "Delft", "Bellville", "Athlone", "Mfuleni", "Kraaifontein", "Blue Downs",
                "Dunoon", "Masiphumelele", "Hout Bay", "Wynberg", "Stellenbosch", "Paarl", "Worcester", "George"),
        .. Each("Gauteng", "Gauteng", "Johannesburg", "Joburg", "Soweto", "Alexandra", "Sandton", "Randburg", "Midrand",
                "Diepsloot", "Tembisa", "Ekurhuleni", "Germiston", "Katlehong", "Thokoza", "Vosloorus", "Benoni", "Boksburg",
                "Pretoria", "Tshwane", "Soshanguve", "Mamelodi", "Atteridgeville", "Ga-Rankuwa", "Mabopane", "Centurion",
                "Hammanskraal", "Orange Farm", "Vereeniging", "Sebokeng", "Krugersdorp"),
        .. Each("KwaZulu-Natal", "KwaZulu-Natal", "KwaZulu Natal", "KZN", "Durban", "eThekwini", "Umlazi", "KwaMashu",
                "Inanda", "Pinetown", "Chatsworth", "Phoenix", "Pietermaritzburg", "Edendale", "Newcastle", "Richards Bay",
                "Empangeni", "Ladysmith", "Port Shepstone"),
        .. Each("Eastern Cape", "Eastern Cape", "Gqeberha", "Port Elizabeth", "Nelson Mandela Bay", "Motherwell",
                "New Brighton", "East London", "Mdantsane", "Mthatha", "Komani", "Queenstown"),
        .. Each("Free State", "Free State", "Bloemfontein", "Mangaung", "Botshabelo", "Welkom", "Bethlehem"),
        .. Each("Limpopo", "Limpopo", "Polokwane", "Seshego", "Thohoyandou", "Tzaneen"),
        .. Each("Mpumalanga", "Mpumalanga", "Mbombela", "Nelspruit", "KwaNdebele", "eMalahleni", "Witbank", "Secunda"),
        .. Each("North West", "North West", "Rustenburg", "Mahikeng", "Mafikeng", "Potchefstroom", "Klerksdorp"),
        .. Each("Northern Cape", "Northern Cape", "Kimberley", "Upington"),
    ];

    private static IEnumerable<(string, string)> Each(string province, params string[] places) =>
        places.Select(p => (p, province));

    private static string Stem(string w) => w.Length > 3 && w.EndsWith('s') ? w[..^1] : w;

    [GeneratedRegex(@"[\p{L}\p{N}'’-]+")]
    private static partial Regex Words();
}
