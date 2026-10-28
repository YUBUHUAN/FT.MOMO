using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MomoPet;

public sealed class ApiException : Exception
{
    public JsonNode? Body { get; }

    public ApiException(string message, JsonNode? body = null) : base(message)
    {
        Body = body;
    }
}

/// <summary>Account login + per-account state client for the local sync server.</summary>
public sealed class ApiClient
{
    private readonly HttpClient _http;

    public string BaseUrl { get; }
    public string Token { get; set; } = "";
    public string AccountName { get; private set; } = "";
    public string AccountId { get; private set; } = "";
    public JsonNode? Content { get; private set; }
    public JsonNode? State { get; set; }
    public bool Online { get; private set; } = true;

    public ApiClient(string baseUrl)
    {
        BaseUrl = baseUrl.TrimEnd('/');
        _http = new HttpClient { BaseAddress = new Uri(BaseUrl + "/"), Timeout = TimeSpan.FromSeconds(12) };
    }

    public bool HasSession => !string.IsNullOrWhiteSpace(Token);

    private void ApplyAuth(HttpRequestMessage request)
    {
        if (HasSession) request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", Token);
    }

    public async Task LoadContentAsync()
    {
        string json = await _http.GetStringAsync("api/content");
        Content = JsonNode.Parse(json);
    }

    public async Task<JsonNode> RegisterAsync(string username, string password) =>
        await AuthAsync("api/auth/register", username, password);

    public async Task<JsonNode> LoginAsync(string username, string password) =>
        await AuthAsync("api/auth/login", username, password);

    private async Task<JsonNode> AuthAsync(string path, string username, string password)
    {
        var body = new JsonObject { ["username"] = username, ["password"] = password };
        using var content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var res = await _http.PostAsync(path, content);
        string json = await res.Content.ReadAsStringAsync();
        JsonNode root = JsonNode.Parse(json) ?? throw new ApiException("空响应");
        if (!res.IsSuccessStatusCode || root["ok"]?.GetValue<bool>() == false)
        {
            string reason = root["error"]?.GetValue<string>() ?? "auth_failed";
            throw new ApiException(reason, root);
        }
        Token = root["token"]?.GetValue<string>() ?? "";
        AccountName = root["account"]?["username"]?.GetValue<string>() ?? "";
        AccountId = root["account"]?["id"]?.GetValue<string>() ?? "";
        State = root["state"];
        Online = true;
        return root;
    }

    public async Task<bool> TryMeAsync()
    {
        if (!HasSession) return false;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, "api/auth/me");
            ApplyAuth(req);
            using var res = await _http.SendAsync(req);
            if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) return false;
            if (!res.IsSuccessStatusCode) throw new ApiException("me_failed");
            string json = await res.Content.ReadAsStringAsync();
            JsonNode root = JsonNode.Parse(json) ?? throw new ApiException("空响应");
            if (root["ok"]?.GetValue<bool>() == false) return false;
            AccountName = root["account"]?["username"]?.GetValue<string>() ?? AccountName;
            AccountId = root["account"]?["id"]?.GetValue<string>() ?? AccountId;
            Online = true;
            return true;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            Online = false;
            return false;
        }
    }

    public async Task<JsonNode> GetStateAsync()
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, "api/state");
        ApplyAuth(req);
        try
        {
            using var res = await _http.SendAsync(req);
            string json = await res.Content.ReadAsStringAsync();
            if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) throw new ApiException("unauthorized");
            JsonNode root = JsonNode.Parse(json) ?? throw new ApiException("空状态");
            if (!res.IsSuccessStatusCode || root["ok"]?.GetValue<bool>() == false) throw new ApiException("state_failed");
            State = root["state"];
            Online = true;
            return root;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            Online = false;
            throw;
        }
    }

    public async Task<JsonNode> ActionAsync(string type, Dictionary<string, object?>? payload = null)
    {
        var action = new JsonObject { ["type"] = type };
        if (payload != null)
        {
            foreach (var kv in payload)
            {
                action[kv.Key] = kv.Value switch
                {
                    null => null,
                    JsonNode node => node.DeepClone(),
                    _ => JsonSerializer.SerializeToNode(kv.Value)
                };
            }
        }
        var body = new JsonObject { ["action"] = action };
        using var req = new HttpRequestMessage(HttpMethod.Post, "api/action")
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json")
        };
        ApplyAuth(req);
        try
        {
            using var res = await _http.SendAsync(req);
            string json = await res.Content.ReadAsStringAsync();
            JsonNode root = JsonNode.Parse(json) ?? throw new ApiException("空响应");
            if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) throw new ApiException("unauthorized");
            if (!res.IsSuccessStatusCode || root["ok"]?.GetValue<bool>() == false)
            {
                string reason = root["result"]?["error"]?.GetValue<string>()
                                ?? root["error"]?.GetValue<string>()
                                ?? "action_failed";
                throw new ApiException(reason, root);
            }
            State = root["state"];
            Online = true;
            return root;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            Online = false;
            throw;
        }
    }

    public async Task<JsonNode> FriendCodeAsync() =>
        await FriendGetAsync("api/friend/code");

    public async Task<JsonNode> FriendPendingAsync() =>
        await FriendGetAsync("api/friend/pending");

    public async Task<JsonNode> FriendStatusAsync() =>
        await FriendGetAsync("api/friend/status");

    public async Task<JsonNode> FriendRequestAsync(string code) =>
        await FriendPostAsync("api/friend/request", new JsonObject { ["code"] = code });

    public async Task<JsonNode> FriendUnbindAsync() =>
        await FriendPostAsync("api/friend/unbind", new JsonObject());

    private async Task<JsonNode> FriendGetAsync(string path)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, path);
        ApplyAuth(req);
        using var res = await _http.SendAsync(req);
        string json = await res.Content.ReadAsStringAsync();
        JsonNode root = JsonNode.Parse(json) ?? throw new ApiException("空响应");
        if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) throw new ApiException("unauthorized");
        if (!res.IsSuccessStatusCode || root["ok"]?.GetValue<bool>() == false)
            throw new ApiException(root["error"]?.GetValue<string>() ?? "friend_failed", root);
        return root;
    }

    private async Task<JsonNode> FriendPostAsync(string path, JsonObject body)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json")
        };
        ApplyAuth(req);
        using var res = await _http.SendAsync(req);
        string json = await res.Content.ReadAsStringAsync();
        JsonNode root = JsonNode.Parse(json) ?? throw new ApiException("空响应");
        if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) throw new ApiException("unauthorized");
        if (!res.IsSuccessStatusCode || root["ok"]?.GetValue<bool>() == false)
            throw new ApiException(root["error"]?.GetValue<string>() ?? "friend_failed", root);
        return root;
    }

    public async Task LogoutAsync()
    {
        if (!HasSession) return;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, "api/auth/logout");
            ApplyAuth(req);
            await _http.SendAsync(req);
        }
        catch { }
        Token = "";
        AccountName = "";
        AccountId = "";
        State = null;
    }

    public void MarkOffline() => Online = false;
}
