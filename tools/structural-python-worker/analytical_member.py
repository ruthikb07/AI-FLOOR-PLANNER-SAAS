"""Adapt the pinned PyNite physical-member API to an explicit analytical graph."""
from Pynite.Member3D import Member3D
from Pynite.PhysMember import PhysMember


class AnalyticalMember(PhysMember):
    def descritize(self):
        """Preserve the supplied endpoints when PyNite prepares its internal members."""
        member = Member3D(self.model, self.name + "a", self.i_node, self.j_node,
                          self.material.name, self.section.name, self.rotation,
                          self.tension_only, self.comp_only)
        member.Releases = list(self.Releases)
        member.DistLoads = list(self.DistLoads)
        member.PtLoads = list(self.PtLoads)
        member.active = {name: True for name in self.model.load_combos}
        self.sub_members = {member.name: member}
