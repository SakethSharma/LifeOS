import { Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { AiService } from "../../core/services/ai.service";
import { AI_CONNECT_FRAGMENT, getProviderInfo } from "../../core/ai/ai-provider-guides";

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
    return c ? getProviderInfo(c.provider).label : "";
  });

  aiStatusText = computed(() => {
    if (!this.aiConnection()) return "AI not connected";
    return this.ai.status().state === "error" ? "AI connection issue" : "AI connected";
  });
}
