<script lang="ts">
  import Download from '@lucide/svelte/icons/download';
  import HardDrive from '@lucide/svelte/icons/hard-drive';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { app } from '$lib/state/app.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import Button from './ui/button.svelte';
  import Dialog from './ui/dialog.svelte';

  type Props = { open: boolean };
  let { open = $bindable(false) }: Props = $props();

  async function clearAll() {
    const ok = await ui.confirmAction({
      title: 'Hapus semua data SyncScore?',
      message: `Seluruh ${app.projects.length} proyek beserta data mahasiswa, pemetaan, dan riwayatnya akan dihapus permanen dari browser ini. Tindakan ini tidak dapat dibatalkan.`,
      confirmLabel: 'Hapus semua data',
      destructive: true,
    });
    if (!ok) return;
    await app.clearAllData();
    open = false;
  }
</script>

<Dialog bind:open title="Privasi & penyimpanan data" class="max-w-xl">
  <div class="space-y-4 text-sm">
    <div class="flex gap-3">
      <ShieldCheck class="mt-0.5 size-5 shrink-0 text-st-match-fg" />
      <div>
        <p class="font-medium">Semua pemrosesan terjadi di browser Anda</p>
        <p class="text-muted-foreground">
          Berkas Excel dan data mahasiswa (NIM, nama, nilai) dibaca dan diproses di perangkat ini. SyncScore tidak memiliki server, tidak mengunggah data, tidak memakai analitik, dan tidak mengirim data ke layanan eksternal.
        </p>
      </div>
    </div>
    <div class="flex gap-3">
      <HardDrive class="mt-0.5 size-5 shrink-0 text-primary" />
      <div>
        <p class="font-medium">Proyek tersimpan di browser dan perangkat ini saja</p>
        <p class="text-muted-foreground">
          Proyek disimpan otomatis di IndexedDB browser ini. Data tidak tersedia di browser atau perangkat lain, dan dapat hilang jika data situs dihapus. Ekspor cadangan secara berkala untuk mengamankan atau memindahkan proyek.
        </p>
        {#if app.storageError}<p class="mt-1 text-destructive">{app.storageError}</p>{/if}
      </div>
    </div>
    <div class="flex flex-wrap gap-2 rounded-lg border bg-muted/40 p-3">
      <Button size="sm" variant="outline" onclick={() => app.exportBackup()}><Download /> Ekspor cadangan proyek ini</Button>
      <Button size="sm" variant="destructive" onclick={clearAll}><Trash2 /> Hapus semua data lokal</Button>
    </div>
  </div>
</Dialog>
