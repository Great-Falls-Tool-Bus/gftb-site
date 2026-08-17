output "carrier_resource_suffix" {
  description = "Suffix for the config/production-convergence.json carrier_resource declaration: prepend the instantiation's own module label (e.g. module.converge_agent.kubernetes_manifest.converge_agent[0]). The index is unconditional because the carrier is count-gated inside the module (var.enabled), so the address shape does not change when a tenant arms or disarms its gate; site.scaffold #128 admits the index suffix in the declaration schema."
  value       = "kubernetes_manifest.converge_agent[0]"
}

output "enabled" {
  description = "Whether this instantiation composes a carrier at all. False is the inert-gate state: no resource, no schedule, a visible stack diff to arm."
  value       = var.enabled
}

output "tenant" {
  description = "Tenant this instantiation converges."
  value       = var.tenant
}

output "state_key" {
  description = "The one production state key this carrier writes (isolation contract: disjoint across tenants)."
  value       = var.state_backend.key
}
