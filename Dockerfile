FROM mcr.microsoft.com/dotnet/sdk:11.0 AS build
WORKDIR /src
COPY src/ src/
RUN dotnet publish src/Devices.Simulator.Web/Devices.Simulator.Web.csproj -c Release -o /out/simulator \
    && dotnet publish src/Devices.Instrumentation.Web/Devices.Instrumentation.Web.csproj -c Release -o /out/instrumentation

FROM mcr.microsoft.com/dotnet/aspnet:11.0 AS simulator
WORKDIR /app
COPY --from=build /out/simulator/ .
ENTRYPOINT ["dotnet", "Devices.Simulator.Web.dll"]

FROM mcr.microsoft.com/dotnet/aspnet:11.0 AS instrumentation
WORKDIR /app
COPY --from=build /out/instrumentation/ .
ENTRYPOINT ["dotnet", "Devices.Instrumentation.Web.dll"]
