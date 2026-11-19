export const architecturePhotos = {
  residence: { file: 'residence', alt: 'Glazed apartment balconies framed by palms', title: 'Street frontage', credit: 'Mauricio Krupka Buendia', source: 'https://www.pexels.com/photo/30509382/' },
  facade: { file: 'facade', alt: 'Curved balconies with timber soffits on a residential building in Dubai', title: 'Balcony rhythm, Dubai', credit: 'Na Ngel', source: 'https://www.pexels.com/photo/36944268/' },
  arrival: { file: 'arrival', alt: 'Stone and timber screens in a double-height arrival hall', title: 'Arrival sequence', credit: 'Denys Gromov', source: 'https://www.pexels.com/photo/8312027/' },
  interior: { file: 'interior', alt: 'Contemporary living room with warm wood finishes and city views', title: 'Living spaces', credit: 'Emre Gokceoglu', source: 'https://www.pexels.com/photo/29515355/' },
  construction: { file: 'construction', alt: 'Concrete residential towers under construction with cranes at sunset', title: 'Structure under construction', credit: 'Нурлан', source: 'https://www.pexels.com/photo/13672589/' },
  roof: { file: 'roof', alt: 'Infinity pool above a city skyline at dusk', title: 'Rooftop amenity', credit: 'ROMAN ODINTSOV', source: 'https://www.pexels.com/photo/5339086/' },
} as const;

export type ArchitecturePhoto = (typeof architecturePhotos)[keyof typeof architecturePhotos];

export function photoUrl(photo: ArchitecturePhoto) {
  return `${import.meta.env.BASE_URL}architecture/${photo.file}.webp`;
}
