import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getCompanySettings, CompanySettings } from '../api/company';

interface BrandingState {
    brand_name: string;
    logo_path: string;
    primary_color: string;
    settings: CompanySettings | null;
    fetchSettings: () => Promise<void>;
    updateSettings: (newSettings: CompanySettings) => void;
    setBrandName: (name: string) => void;
    setPrimaryColor: (color: string) => void;
}

export const useBrandingStore = create<BrandingState>()(
    persist(
        (set) => ({
            brand_name: 'geom365',
            logo_path: '/geom365_logo.png',
            primary_color: '#8c2785',
            settings: null,
            fetchSettings: async () => {
                try {
                    const settings = await getCompanySettings();
                    set({ 
                        settings, 
                        brand_name: settings.brand_name || 'geom365',
                        logo_path: settings.logo_path || '/geom365_logo.png',
                        primary_color: settings.primary_color || '#8c2785'
                    });
                    if (settings.primary_color) {
                        document.documentElement.style.setProperty('--clr-primary', settings.primary_color);
                    }
                } catch (error) {
                    console.error('Failed to fetch company settings', error);
                }
            },
            updateSettings: (newSettings) => {
                set({ 
                    settings: newSettings, 
                    brand_name: newSettings.brand_name || 'geom365',
                    logo_path: newSettings.logo_path || '/geom365_logo.png',
                    primary_color: newSettings.primary_color || '#8c2785'
                });
            },
            setBrandName: (brand_name) => set({ brand_name }),
            setPrimaryColor: (primary_color) => {
                set({ primary_color });
                document.documentElement.style.setProperty('--clr-primary', primary_color);
            },
        }),
        {
            name: 'branding-storage',
        }
    )
);
