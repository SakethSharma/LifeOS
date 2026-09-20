import { Routes } from "@angular/router";

export const routes: Routes = [
  {
    path: "",
    redirectTo: "home",
    pathMatch: "full",
  },

  {
    path: "home",
    loadComponent: () =>
      import("./features/home/home.component").then((m) => m.HomeComponent),
    title: "LifeOS — Home",
  },

  {
    path: "",
    loadComponent: () =>
      import("./layout/layout.component").then((m) => m.LayoutComponent),
    children: [
      {
        path: "dashboard",
        loadComponent: () =>
          import("./features/dashboard/dashboard.component").then(
            (m) => m.DashboardComponent,
          ),
        title: "Dashboard — LifeOS",
      },

      {
        path: "transactions",
        loadComponent: () =>
          import("./features/transactions/transactions.component").then(
            (m) => m.TransactionsComponent,
          ),
        title: "Transactions — LifeOS",
      },

      {
        path: "analytics",
        loadComponent: () =>
          import("./features/analytics/analytics.component").then(
            (m) => m.AnalyticsComponent,
          ),
        title: "Analytics — LifeOS",
      },

      {
        path: "ai-insights",
        loadComponent: () =>
          import("./features/ai-insights/ai-insights.component").then(
            (m) => m.AiInsightsComponent,
          ),
        title: "AI Insights — LifeOS",
      },

      {
        path: "settings",
        loadComponent: () =>
          import("./features/settings/settings.component").then(
            (m) => m.SettingsComponent,
          ),
        title: "Settings — LifeOS",
      },
    ],
  },

  {
    path: "**",
    redirectTo: "home",
  },
];
