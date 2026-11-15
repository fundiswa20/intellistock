using IntelliStock.Api.Domain;

namespace IntelliStock.Api.Tests.Unit;

// D39: matching a stock item to supplier listings, and the delivery-area check
public class ProductMatchTests
{
    [Theory]
    [InlineData("Clover Long Life Milk 1L", "milk")]
    [InlineData("Albany Brown Bread 700g", "bread")]
    [InlineData("Joko Tea 100 bags", "tea")]
    [InlineData("Large Eggs 6-pack", "eggs")]
    [InlineData("Coca-Cola 2L", "coca-cola")]
    [InlineData("Paraffin 1L", "paraffin")]
    public void The_key_term_is_the_product_word_before_the_size(string name, string term) =>
        Assert.Equal(term, ProductMatch.KeyTerm(name));

    [Theory]
    [InlineData("Clover Long Life Milk 1L", "Clover Long Life Milk 1L", true)]
    [InlineData("Clover Long Life Milk 1L", "Parmalat Full Cream MILK 2L", true)]
    [InlineData("Albany Brown Bread 700g", "Loaf of bread", true)]
    [InlineData("Albany Brown Bread 700g", "Sasko White Bread 700g", true)]
    [InlineData("Large Eggs 6-pack", "Free range egg tray", true)]
    [InlineData("Joko Tea 100 bags", "Steak sauce", false)]
    [InlineData("Clover Long Life Milk 1L", "Inkomazi Amasi 2L", false)]
    public void A_listing_matches_when_it_names_the_same_product(string item, string listing, bool expected) =>
        Assert.Equal(expected, ProductMatch.Matches(item, listing));

    [Theory]
    [InlineData("Section 3, Khayelitsha, Cape Town", "Khayelitsha, Mitchells Plain, Philippi", true)]
    [InlineData("Section 3, khayelitsha, Cape Town", "KHAYELITSHA", true)]
    [InlineData("Section 3, Khayelitsha, Cape Town", "Tshwane North, Soshanguve", false)]
    [InlineData("Johannesburg", null, false)]
    [InlineData("", "Cape Flats", false)]
    public void The_owner_is_in_a_suppliers_area_when_their_location_names_one_of_its_places(
        string owner, string? area, bool expected) =>
        Assert.Equal(expected, ProductMatch.InArea(owner, area));
}
