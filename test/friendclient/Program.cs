using MomoPet;
using System.Text.Json;
var api = new ApiClient("http://127.0.0.1:9");
var raw = File.ReadAllText(@"D:\made in harness\dist\MomoPet-Windows-Portable\desktop-settings.json");
using var doc = JsonDocument.Parse(raw);
api.Token = doc.RootElement.GetProperty("Token").GetString() ?? "";
Console.WriteLine($"tokenLen={api.Token.Length}");
try { var r = await api.FriendCodeAsync(); Console.WriteLine(r?.ToJsonString()); }
catch (Exception e) { Console.WriteLine($"ERR {e.GetType().Name}: {e.Message}"); if (e is ApiException a) Console.WriteLine(a.Body?.ToJsonString()); }
try { var r = await api.FriendEventsAsync(); Console.WriteLine(r?.ToJsonString()); }
catch (Exception e) { Console.WriteLine($"ERR2 {e.GetType().Name}: {e.Message}"); if (e is ApiException a) Console.WriteLine(a.Body?.ToJsonString()); }
