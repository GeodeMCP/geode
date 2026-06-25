/** Returns the RFC 9728 protected resource metadata document advertising the MCP resource and its authorization server. */
export function protectedResourceMetadata(baseUrl: string) {
  return { resource: `${baseUrl}/mcp`, authorization_servers: [baseUrl], scopes_supported: ["vault"], bearer_methods_supported: ["header"] };
}
/** Returns the RFC 8414 authorization server metadata document describing all supported endpoints and capabilities. */
export function authorizationServerMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    scopes_supported: ["vault"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
  };
}
