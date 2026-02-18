import { useLocation, Link } from "wouter";
import { Wine, LayoutDashboard, Package, Users, FileText, Tag, BarChart3, Gift, Grape } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";

const mainNav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Items", url: "/items", icon: Package },
  { title: "Customers", url: "/customers", icon: Users },
];

const salesNav = [
  { title: "Invoices", url: "/invoices", icon: FileText },
  { title: "Credit Notes", url: "/credit-notes", icon: FileText },
  { title: "Proforma", url: "/proforma", icon: FileText },
];

const pricingNav = [
  { title: "Price Contracts", url: "/pricing", icon: Tag },
  { title: "Seasonal Offers", url: "/offers", icon: Gift },
];

const reportNav = [
  { title: "Reports", url: "/reports", icon: BarChart3 },
];

function NavSection({ label, items }: { label: string; items: typeof mainNav }) {
  const [location] = useLocation();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild data-active={isActive}>
                  <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                    <item.icon className="w-4 h-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-sidebar-primary">
            <Grape className="w-4 h-4 text-sidebar-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-sidebar-foreground">VinTrade</span>
            <span className="text-xs text-sidebar-foreground/60">Wholesale Management</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavSection label="Overview" items={mainNav} />
        <NavSection label="Sales" items={salesNav} />
        <NavSection label="Pricing" items={pricingNav} />
        <NavSection label="Analytics" items={reportNav} />
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="flex items-center gap-2 text-xs text-sidebar-foreground/50">
          <Wine className="w-3 h-3" />
          <span>VinTrade v1.0</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
