FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY IntelliStock.Api/IntelliStock.Api.csproj IntelliStock.Api/
RUN dotnet restore IntelliStock.Api/IntelliStock.Api.csproj
COPY IntelliStock.Api/ IntelliStock.Api/
RUN dotnet publish IntelliStock.Api/IntelliStock.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "IntelliStock.Api.dll"]
