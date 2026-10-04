import { Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { AiService } from "../../core/services/ai.service";
import { AI_CONNECT_FRAGMENT, providerLabel } from "../../core/ai/ai-provider-guides";

@Component({
  selector: "app-settings",
  standalone: true,
  imports: [RouterLink],
  templateUrl: "./settings.component.html",
  styleUrl: "./settings.component.scss",
})
export class SettingsComponent {
  private ai = inject(AiService);

  readonly aiConnectFragment = AI_CONNECT_FRAGMENT;

  aiConnection = this.ai.connection;

  aiProviderLabel = computed(() => {
    const c = this.aiConnection();
    if (!c) return "";

    const others = Object.keys(this.ai.connections()).length - 1;
    const label = providerLabel(c.provider) + (c.model ? ` · ${c.model}` : "");
    return others > 0 ? `${label} (+${others} more configured)` : label;
  });

  aiStatusText = computed(() => {
    if (!this.aiConnection()) return "AI not connected";

    switch (this.ai.status().state) {
      case "error":
        return "AI connection issue";
      case "not_tested":
        return "AI provider not tested";
      default:
        return "AI connected";
    }
  });
}
