import { Component, signal, computed, inject } from "@angular/core";
import {
  Router,
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
} from "@angular/router";

import { SettingsService } from "../core/services/settings.service";
import { ThemeService } from "../core/services/theme.service";

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

@Component({
  selector: "app-layout",
  templateUrl: "./layout.component.html",
  styleUrl: "./layout.component.scss",
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
})
export class LayoutComponent {
  private readonly router = inject(Router);
  private readonly settings = inject(SettingsService);
  private readonly themeService = inject(ThemeService);

  sidebarOpen = signal(false);

  isDark = this.themeService.isDark;

  navItems: NavItem[] = [
    {
      label: "Dashboard",
      icon: "dashboard",
      route: "/dashboard",
    },
    {
      label: "Transactions",
      icon: "transactions",
      route: "/transactions",
    },
    {
      label: "Analytics",
      icon: "analytics",
      route: "/analytics",
    },
    {
      label: "AI Insights",
      icon: "ai",
      route: "/ai-insights",
    },
    {
      label: "Settings",
      icon: "settings",
      route: "/settings",
    },
  ];

  bottomNavItems: NavItem[] = [
    {
      label: "Home",
      icon: "home",
      route: "/home",
    },
    {
      label: "Dashboard",
      icon: "dashboard",
      route: "/dashboard",
    },
    {
      label: "Transactions",
      icon: "transactions",
      route: "/transactions",
    },
    {
      label: "Analytics",
      icon: "analytics",
      route: "/analytics",
    },
    {
      label: "Settings",
      icon: "settings",
      route: "/settings",
    },
  ];

  pageTitle = computed(() => {
    const url = this.router.url;

    const item = this.navItems.find((navItem) => url.startsWith(navItem.route));

    return item?.label ?? "LifeOS";
  });

  toggleSidebar(): void {
    this.sidebarOpen.update((isOpen) => !isOpen);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  async toggleTheme(): Promise<void> {
    const currentTheme = this.settings.theme();

    const isCurrentlyDark =
      currentTheme === "dark" ||
      (currentTheme === "system" && this.themeService.isDark());

    await this.settings.setTheme(isCurrentlyDark ? "light" : "dark");
  }

  getIcon(name: string): string {
    const icons: Record<string, string> = {
      home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',

      dashboard:
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',

      transactions:
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',

      analytics:
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>',

      ai: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v1.5a3 3 0 0 0 3 3 3 3 0 0 0 3-3V5a3 3 0 0 0-3-3z"/><path d="M12 14.5a3 3 0 0 0-3 3V19a3 3 0 0 0 6 0v-1.5a3 3 0 0 0-3-3z"/><path d="M5 8a3 3 0 0 0 0 6h1.5a3 3 0 0 0 0-6H5z"/><path d="M17.5 8a3 3 0 0 0 0 6H19a3 3 0 0 0 0-6h-1.5z"/></svg>',

      settings:
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    };

    return icons[name] ?? "";
  }
}
