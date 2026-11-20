<script lang="ts">
  import Download from '@lucide/svelte/icons/download';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Upload from '@lucide/svelte/icons/upload';
  import { app } from '$lib/state/app.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { cn, formatDateTime } from '$lib/utils';
  import Button from './ui/button.svelte';
  import ContextMenu from './ui/context-menu.svelte';
  import Dialog from './ui/dialog.svelte';

  type Props = { open: boolean };
  let { open = $bindable(false) }: Props = $props();
  let fileInput = $state<HTMLInputElement | null>(null);

  async function create() {
    const name = await ui.promptText({ title: 'Proyek baru', label: 'Nama proyek (mis. "Algoritma 2026 Kelas A")', confirmLabel: 'Buat' });
    if (!name) return;
    await app.newProject(name);
    open = false;
  }

  async function openP(id: string) {
    await app.openProject(id);
    open = false;
  }

  async function rename(id: string, current: string) {
    const name = await ui.promptText({ title: 'Ganti nama proyek', label: 'Nama proyek', value: current });
    if (name) await app.renameProjectById(id, name);
  }

  async function remove(id: string, name: string) {
    const ok = await ui.confirmAction({
      title: `Hapus proyek "${name}"?`,
      message: 'Proyek beserta seluruh data, pemetaan, dan riwayatnya akan dihapus permanen dari browser ini. Ekspor cadangan terlebih dahulu jika masih diperlukan.',
      confirmLabel: 'Hapus proyek',
      destructive: true,
    });
    if (ok) await app.deleteProject(id);
  }

  function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void app.importBackup(f).then(() => (open = false));
  }
</script>

<Dialog bind:open title="Proyek" description="Proyek disimpan otomatis di browser ini (IndexedDB) pada perangkat ini." class="max-w-2xl">
  <div class="space-y-3">
    <div class="flex flex-wrap gap-2">
      <Button size="sm" onclick={create}><Plus /> Proyek baru</Button>
      <Button size="sm" variant="outline" onclick={() => fileInput?.click()}><Upload /> Impor cadangan (.json)</Button>
      <input bind:this={fileInput} type="file" accept=".json,application/json" class="hidden" onchange={onFile} />
    </div>
    {#if app.projects.length === 0}
      <p class="text-sm text-muted-foreground">Belum ada proyek tersimpan.</p>
    {:else}
      <ul class="divide-y rounded-lg border">
        {#each app.projects as p (p.id)}
          {@const isCurrent = p.id === app.project?.id}
          <ContextMenu
            as="li"
            class={cn('flex flex-wrap items-center gap-2 px-3 py-2', isCurrent && 'bg-accent/50')}
            items={[
              { label: 'Buka', icon: FolderOpen, disabled: isCurrent, onSelect: () => openP(p.id) },
              { label: 'Ganti nama', icon: Pencil, onSelect: () => rename(p.id, p.name) },
              { label: 'Ekspor cadangan', icon: Download, onSelect: () => app.exportBackupById(p.id) },
              { kind: 'separator' },
              { label: 'Hapus proyek', icon: Trash2, destructive: true, onSelect: () => remove(p.id, p.name) },
            ]}
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{p.name} {#if isCurrent}<span class="text-xs font-normal text-primary">(terbuka)</span>{/if}</p>
              <p class="text-xs text-muted-foreground">Diubah {formatDateTime(p.updatedAt)}</p>
            </div>
            {#if !isCurrent}
              <Button size="xs" variant="outline" onclick={() => openP(p.id)}><FolderOpen /> Buka</Button>
            {/if}
            <Button size="icon-xs" variant="ghost" aria-label={`Ganti nama ${p.name}`} title="Ganti nama" onclick={() => rename(p.id, p.name)}><Pencil /></Button>
            <Button size="icon-xs" variant="ghost" aria-label={`Ekspor cadangan ${p.name}`} title="Ekspor cadangan" onclick={() => app.exportBackupById(p.id)}><Download /></Button>
            <Button size="icon-xs" variant="ghost" class="text-destructive hover:text-destructive" aria-label={`Hapus ${p.name}`} title="Hapus" onclick={() => remove(p.id, p.name)}><Trash2 /></Button>
          </ContextMenu>
        {/each}
      </ul>
    {/if}
  </div>
</Dialog>
