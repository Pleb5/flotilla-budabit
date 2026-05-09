<script lang="ts">
  import { TriangleAlert, FileText, ChevronDown, ChevronRight, Zap, Target } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";
  import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components";
  const { Card, CardContent, CardHeader, CardTitle, Badge, Button } = useRegistry();

  const { conflicts, analysis } = $props();

  let expandedConflicts = $state(new Set<string>());

  const toggleConflict = (file: string) => {
    const newExpanded = new Set(expandedConflicts);
    if (newExpanded.has(file)) {
      newExpanded.delete(file);
    } else {
      newExpanded.add(file);
    }
    expandedConflicts = newExpanded;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high":
        return "border-red-200 bg-red-50";
      case "medium":
        return "border-orange-200 bg-orange-50";
      case "low":
        return "border-yellow-200 bg-yellow-50";
      default:
        return "border-gray-200 bg-gray-50";
    }
  };

  const severityBadge = $derived(() => getSeverityBadge(conflicts[0].severity));

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "high":
        return { variant: "destructive", label: "High Risk" };
      case "medium":
        return { variant: "secondary", label: "Medium Risk" };
      case "low":
        return { variant: "secondary", label: "Low Risk" };
      default:
        return { variant: "outline", label: "Unknown" };
    }
  };

  const typeIcon = $derived(() => getTypeIcon(conflicts[0].type));

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "content":
        return { icon: FileText, color: "text-gray-500" };
      case "formatting":
        return { icon: Target, color: "text-orange-500" };
      case "structure":
        return { icon: Zap, color: "text-blue-500" };
      default:
        return { icon: TriangleAlert, color: "text-gray-500" };
    }
  };

  interface Conflict {
    file: string;
    lines: string;
    type: "content" | "formatting" | "structure";
    severity: "low" | "medium" | "high";
    content?: string;
  }
</script>

{#if conflicts.length === 0}
  <Card class="border-green-200 bg-green-50">
    <CardContent class="flex items-center justify-center py-12">
      <div class="text-center">
        <Target class="h-12 w-12 mx-auto mb-4 text-green-500" />
        <h3 class="text-lg font-medium text-green-800 mb-2">No Conflicts Detected</h3>
        <p class="text-sm text-green-600">
          This PR can be merged cleanly without any conflicts. The merge operation is safe to
          proceed.
        </p>
      </div>
    </CardContent>
  </Card>
{:else}
  <div class="space-y-4">
    <!-- Conflict Summary -->
    <Card class="border-orange-200 bg-orange-50">
      <CardHeader class="pb-3">
        <CardTitle class="text-lg flex items-center gap-2 text-orange-800">
          <TriangleAlert class="h-5 w-5" />
          Conflict Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-3 gap-4">
          <div class="text-center">
            <div class="text-2xl font-bold text-red-600">
              {conflicts.filter((c: Conflict) => c.severity === "high").length}
            </div>
            <div class="text-xs text-muted-foreground">High Risk</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-orange-600">
              {conflicts.filter((c: Conflict) => c.severity === "medium").length}
            </div>
            <div class="text-xs text-muted-foreground">Medium Risk</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-bold text-yellow-600">
              {conflicts.filter((c: Conflict) => c.severity === "low").length}
            </div>
            <div class="text-xs text-muted-foreground">Low Risk</div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Individual Conflicts -->
    <div class="space-y-3">
      {#each conflicts as conflict (conflict.file)}
        <Card class={getSeverityColor(conflict.severity)}>
          <Collapsible>
            <CollapsibleTrigger class="w-full" onclick={() => toggleConflict(conflict.file)}>
              <CardHeader class="pb-3 hover:bg-black/5 transition-colors">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    {#if expandedConflicts.has(conflict.file)}
                      <ChevronDown class="h-4 w-4" />
                    {:else}
                      <ChevronRight class="h-4 w-4" />
                    {/if}
                    {#if typeIcon}
                      {@const { icon: Icon, color } = typeIcon()}
                      <Icon class={color} />
                    {/if}
                    <div class="text-left">
                      <CardTitle class="text-sm font-mono">{conflict.file}</CardTitle>
                      <p class="text-xs text-muted-foreground">
                        Lines {conflict.lines} • {conflict.type} conflict
                      </p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    {#if severityBadge}
                      {@const { variant, label } = severityBadge()}
                      <Badge variant={variant as any}>{label}</Badge>
                    {/if}
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <CardContent class="pt-0">
                <div class="bg-background rounded border p-3">
                  <div class="text-xs text-muted-foreground mb-2">Conflict preview:</div>
                  <pre class="text-xs font-mono whitespace-pre-wrap overflow-x-auto">{conflict.content || "Conflict content not available. Use the diff viewer to see full details."}</pre>
                </div>

                <div class="flex gap-2 mt-3">
                  <Button variant="outline" size="sm">View Full Diff</Button>
                  <Button variant="outline" size="sm">Resolve Manually</Button>
                  <Button variant="outline" size="sm" class="ml-auto">Use Theirs</Button>
                  <Button variant="outline" size="sm">Use Ours</Button>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      {/each}
    </div>
  </div>
{/if}
