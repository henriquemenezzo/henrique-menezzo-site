// Ordem do card empilhado: cada projeto é um painel, e o card desliza entre eles.
export const projects = [
  {
    slug: 'tex',
    href: '/tex#hero',
    title: 'Tex',
    body: 'Increasing trust in car rental checkouts through transparent pricing.',
    card: { bg: 'utZnb24AUIDbZrJNzIV5ypdmh6A.png', phone: 'Ur9rjMlk9WIjN7D6j3czUmuc8fY.png', shots: [] },
  },
  {
    slug: 'babel',
    href: '/babel',
    title: 'Babel',
    body: 'Removing friction from legal workflows and forms with applied AI.',
    card: { bg: 'GjadJ42iLDgF0ERD7bFkZLX9s.jpg', shots: [['24kspesVLMwAdPjBg6XpjJuEy0c.jpg', 'erp']] },
  },
  {
    slug: 'dare',
    href: '/dare',
    title: 'Dare',
    body: 'Enhancing the perception of sports complexity through Interaction Design.',
    card: {
      bg: 'Xn1H7J8CY3SfZPCgPNUNa8.jpg',
      shots: [
        ['sG4t8m5zobxoPJV0hQQhMtlvVCk.jpg', 'phone-a'],
        ['24twWUimYKE2YztNj0onN93DRhE.jpg', 'phone-b'],
      ],
    },
  },
  {
    slug: 'goldcare',
    href: '/goldcare',
    title: 'Goldcare',
    body: 'How a Scalable Design System Saved $45k/Year in Development Costs',
    card: { bg: 'xrNp2bhJoXFh5uETPibzoNMSN1A.jpg', tint: '#d4d4d4', shots: [['bv8cpzBcDLpQqEyeTwp33WB0qs4.png', 'ds']] },
  },
  {
    slug: 'playground',
    href: '/playground',
    title: 'Playground',
    body: 'Exploring new visual languages and experimental interactions.',
    card: { bg: 'g9MKOhDhNHP5FzYazjNhr4RtC0.png', phone: '4o9Q4Lzldnre1gYl15Ux8FXRpJg.png', shots: [] },
  },
] as const;
