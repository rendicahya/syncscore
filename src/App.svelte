<script lang="ts">
  import { onMount } from 'svelte';
  import { DropdownMenu } from 'bits-ui';
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import CloudOff from '@lucide/svelte/icons/cloud-off';
  import FolderKanban from '@lucide/svelte/icons/folder-kanban';
  import History from '@lucide/svelte/icons/history';
  import Link2 from '@lucide/svelte/icons/link-2';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Moon from '@lucide/svelte/icons/moon';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Sun from '@lucide/svelte/icons/sun';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Check from '@lucide/svelte/icons/check';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import DatasetPanel from '$lib/components/DatasetPanel.svelte';
  import DialogHost from '$lib/components/DialogHost.svelte';
  import HistoryPanel from '$lib/components/HistoryPanel.svelte';
  import MappingPanel from '$lib/components/MappingPanel.svelte';
  import MatchingPanel from '$lib/components/MatchingPanel.svelte';
  import PrivacyDialog from '$lib/components/PrivacyDialog.svelte';
  import ProjectsDialog from '$lib/components/ProjectsDialog.svelte';
  import SyncPreviewDialog from '$lib/components/SyncPreviewDialog.svelte';
  import ToastHost from '$lib/components/ToastHost.svelte';
  import Badge from '$lib/components/ui/badge.svelte';
  import Button from '$lib/components/ui/button.svelte';
  import { menuContent, menuItem } from '$lib/components/ui/menu';
  import { summarizeMatch } from '$lib/matching/engine';
  import { app } from '$lib/state/app.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { pwa } from '$lib/state/pwa.svelte';
  import { cn } from '$lib/utils';
  import MonitorDown from '@lucide/svelte/icons/monitor-down';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import WifiOff from '@lucide/svelte/icons/wifi-off';
  import X from '@lucide/svelte/icons/x';

  type WorkTab = 'mapping' | 'matching' | 'history';
  let workTab = $state<WorkTab>('mapping');
  let workSize = $state<'collapsed' | 'normal' | 'expanded'>('normal');
  let mobileView = $state<'source' | 'target' | 'work'>('source');
  let projectsOpen = $state(false);
  let privacyOpen = $state(false);
  let previewOpen = $state(false);

  onMount(() => {
    ui.initTheme();
    void app.init();
    pwa.init();
  });

  const issueCount = $derived.by(() => {
    const m = app.activeMatch;
    if (!m) return 0;
    const s = summarizeMatch(m);
    return s.sourceOnly + s.nameMismatch + s.duplicateRows;
  });

  async function renameProject() {
    if (!app.project) return;
    const name = await ui.promptText({ title: 'Ganti nama proyek', label: 'Nama proyek', value: app.project.name });
    if (name) app.renameProject(name);
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.querySelector('[role="dialog"]')) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      void app.runHistory('undo');
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      void app.runHistory('redo');
    }
  }

  const themeIcon = $derived(ui.theme === 'dark' ? Moon : ui.theme === 'light' ? Sun : Monitor);
  const workTabs: { id: WorkTab; label: string; icon: typeof History }[] = [
    { id: 'mapping', label: 'Pemetaan & Sinkronisasi', icon: ArrowLeftRight },
    { id: 'matching', label: 'Pencocokan', icon: Link2 },
    { id: 'history', label: 'Riwayat', icon: History },
  ];
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<div class="flex h-dvh flex-col overflow-hidden">
  <header class="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 sm:px-4">
    <div class="flex items-center gap-2">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" class="size-7" />
      <div class="leading-tight">
        <p class="text-sm font-semibold tracking-tight">SyncScore</p>
        <p class="hidden text-[11px] text-muted-foreground sm:block">Smart Grade Synchronization</p>
      </div>
    </div>
    <div class="mx-1 hidden h-6 w-px bg-border sm:block"></div>
    {#if app.project}
      <button
        class="min-w-0 truncate rounded-md px-2 py-1 text-sm font-medium hover:bg-accent"
        title="Ganti nama proyek"
        onclick={renameProject}
      >
        {app.project.name}
      </button>
      <span class="hidden items-center gap-1 text-xs text-muted-foreground md:inline-flex" aria-live="polite">
        {#if app.storageError}
          <CloudOff class="size-3.5 text-destructive" /> Tidak tersimpan
        {:else if app.saveState === 'saving'}
          <LoaderCircle class="size-3.5 animate-spin" /> Menyimpan…
        {:else if app.saveState === 'error'}
          <TriangleAlert class="size-3.5 text-destructive" /> Gagal menyimpan
        {:else if app.saveState === 'saved'}
          <Check class="size-3.5 text-st-match-fg" /> Tersimpan di browser ini
        {/if}
      </span>
    {/if}
    <div class="ml-auto flex items-center gap-1">
      {#if !pwa.online}
        <span
          class="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
          title="Tidak ada koneksi internet. Semua fitur tetap berfungsi karena data diproses dan disimpan di perangkat ini."
        >
          <WifiOff class="size-3.5" /> <span class="hidden sm:inline">Offline</span>
        </span>
      {/if}
      {#if pwa.canInstall && !pwa.installed}
        <Button variant="ghost" size="sm" onclick={() => pwa.install()} aria-label="Pasang aplikasi" title="Pasang SyncScore sebagai aplikasi (dapat dipakai offline)">
          <MonitorDown /> <span class="hidden md:inline">Pasang</span>
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!app.undoTarget}
        aria-label="Batalkan (Ctrl+Z)"
        title={app.undoTarget ? `Batalkan: ${app.undoTarget.label} (Ctrl+Z)` : 'Tidak ada yang dapat dibatalkan'}
        onclick={() => app.runHistory('undo')}
      >
        <Undo2 />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!app.redoTarget}
        aria-label="Ulangi (Ctrl+Y)"
        title={app.redoTarget ? `Ulangi: ${app.redoTarget.label} (Ctrl+Y)` : 'Tidak ada yang dapat diulang'}
        onclick={() => app.runHistory('redo')}
      >
        <Redo2 />
      </Button>
      <div class="mx-1 h-6 w-px bg-border"></div>
      <Button variant="ghost" size="sm" onclick={() => (projectsOpen = true)} aria-label="Kelola proyek">
        <FolderKanban /> <span class="hidden sm:inline">Proyek</span>
      </Button>
      <Button variant="ghost" size="icon-sm" onclick={() => (privacyOpen = true)} aria-label="Privasi dan penyimpanan" title="Privasi & penyimpanan data">
        <ShieldCheck />
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent" aria-label="Tema tampilan" title="Tema">
          {@const Icon = themeIcon}
          <Icon class="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class={menuContent} align="end" sideOffset={4}>
            <DropdownMenu.Item class={menuItem} onSelect={() => ui.setTheme('light')}><Sun /> Terang</DropdownMenu.Item>
            <DropdownMenu.Item class={menuItem} onSelect={() => ui.setTheme('dark')}><Moon /> Gelap</DropdownMenu.Item>
            <DropdownMenu.Item class={menuItem} onSelect={() => ui.setTheme('system')}><Monitor /> Ikuti sistem</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  </header>

  {#if pwa.needRefresh}
    <div class="flex flex-wrap items-center gap-2 border-b bg-primary/10 px-4 py-1.5 text-xs text-foreground" role="status">
      <RefreshCw class="size-3.5 shrink-0 text-primary" />
      <span class="flex-1">Versi baru SyncScore tersedia. Proyek Anda disimpan terlebih dahulu sebelum memuat ulang.</span>
      <Button size="xs" onclick={() => pwa.applyUpdate()}>Perbarui sekarang</Button>
      <Button variant="ghost" size="icon-xs" aria-label="Nanti saja" title="Nanti saja" onclick={() => pwa.dismissUpdate()}><X /></Button>
    </div>
  {/if}

  {#if app.storageError}
    <div class="flex items-center gap-2 border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
      <TriangleAlert class="size-3.5 shrink-0" /> {app.storageError}
    </div>
  {/if}

  {#if !app.ready || !app.project}
    <div class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      <LoaderCircle class="mr-2 size-4 animate-spin" /> Memuat proyek…
    </div>
  {:else}
    <!-- Mobile view switcher -->
    <nav class="flex shrink-0 gap-1 border-b bg-card p-1.5 lg:hidden" aria-label="Tampilan">
      {#each [{ id: 'source', label: 'Sumber' }, { id: 'target', label: 'Target' }, { id: 'work', label: 'Proses' }] as v (v.id)}
        <button
          class={cn(
            'flex-1 rounded-md py-1.5 text-sm',
            mobileView === v.id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
          )}
          aria-pressed={mobileView === v.id}
          onclick={() => (mobileView = v.id as typeof mobileView)}
        >
          {v.label}
        </button>
      {/each}
    </nav>

    <main class="flex min-h-0 flex-1 flex-col gap-3 bg-background p-2 sm:p-3">
      <div
        class={cn(
          'min-h-0 flex-1 gap-3 lg:grid lg:grid-cols-2',
          mobileView === 'work' ? 'hidden lg:grid' : 'flex flex-col',
          workSize === 'expanded' && 'lg:flex-[0.8]',
        )}
      >
        <div class={cn('min-h-0 flex-1 lg:block', mobileView === 'source' ? 'block' : 'hidden')}>
          <DatasetPanel role="source" />
        </div>
        <div class={cn('min-h-0 flex-1 lg:block', mobileView === 'target' ? 'block' : 'hidden')}>
          <DatasetPanel role="target" />
        </div>
      </div>

      <section
        class={cn(
          'flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs',
          mobileView === 'work' ? 'min-h-0 flex-1' : 'hidden lg:flex',
          workSize === 'collapsed' ? 'lg:h-11' : workSize === 'expanded' ? 'lg:h-[52dvh]' : 'lg:h-[300px]',
        )}
        aria-label="Proses sinkronisasi"
      >
        <div class="flex shrink-0 items-center gap-1 border-b px-2 py-1.5" role="tablist">
          {#each workTabs as t (t.id)}
            {@const Icon = t.icon}
            <button
              role="tab"
              aria-selected={workTab === t.id}
              class={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] whitespace-nowrap',
                workTab === t.id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
              onclick={() => {
                workTab = t.id;
                if (workSize === 'collapsed') workSize = 'normal';
              }}
            >
              <Icon class="size-4" />
              <span class="hidden sm:inline">{t.label}</span>
              {#if t.id === 'matching' && issueCount}<Badge variant="mismatch">{issueCount}</Badge>{/if}
            </button>
          {/each}
          <div class="ml-auto hidden items-center gap-0.5 lg:flex">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={workSize === 'expanded' ? 'Kecilkan panel' : 'Besarkan panel'}
              onclick={() => (workSize = workSize === 'expanded' ? 'normal' : 'expanded')}
            >
              <ChevronUp class={cn(workSize === 'expanded' && 'rotate-180')} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={workSize === 'collapsed' ? 'Tampilkan panel' : 'Sembunyikan panel'}
              onclick={() => (workSize = workSize === 'collapsed' ? 'normal' : 'collapsed')}
            >
              <ChevronDown class={cn(workSize === 'collapsed' && 'rotate-180')} />
            </Button>
          </div>
        </div>
        <div class={cn('min-h-0 flex-1', workSize === 'collapsed' && 'lg:hidden')}>
          {#if workTab === 'mapping'}
            <MappingPanel onPreview={() => (previewOpen = true)} />
          {:else if workTab === 'matching'}
            <MatchingPanel />
          {:else}
            <HistoryPanel />
          {/if}
        </div>
      </section>
    </main>
  {/if}
</div>

{#if app.project}
  <ProjectsDialog bind:open={projectsOpen} />
  <PrivacyDialog bind:open={privacyOpen} />
  <SyncPreviewDialog bind:open={previewOpen} />
{/if}
<DialogHost />
<ToastHost />
